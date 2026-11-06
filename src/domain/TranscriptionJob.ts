import { AudioLines, LineRule } from "./AudioLines";
import { InlineTags } from "./InlineTags";
import {
	AudioDurations,
	AudioEmbed,
	DeletionJournal,
	JobReport,
	ProgressListener,
	TaskFailure,
	Transcriber,
	TranscriptionTask,
	VaultGateway,
} from "./ports";
import { TranscriptionRule, ValidRule } from "./TranscriptionRule";

/** Audio the rules select across the vault. */
export interface RuleOptions {
	readonly rules: readonly TranscriptionRule[];
}

/**
 * Only this note is processed, every audio in it, no tag needed; no other note is read for selection or edited.
 * The rules only decide which tags leave its transcribed lines; invalid rules are ignored here.
 */
export interface SingleNoteOptions {
	readonly notePath: string;
	readonly rules: readonly TranscriptionRule[];
}

export type JobOptions = RuleOptions | SingleNoteOptions;

interface PlannedTask extends TranscriptionTask {
	readonly lines: AudioLines;
}

class CancelledError extends Error {}

/**
 * Audio is selected by rules: a folder or daily-note scope, and optionally a tag on the audio's line.
 * References standing side by side are parts of one recording and become one text.
 * Per-audio order is what makes a run safe to interrupt at any point:
 * transcribe → journal the pending deletion → replace embed in note → trash orphaned audio → clear journal.
 * The audio is trashed only when nothing references it anymore, so it can never be lost before its text is saved.
 */
export class TranscriptionJob {
	private readonly transcripts = new Map<string, string>();

	constructor(
		private readonly vault: VaultGateway,
		private readonly transcriber: Transcriber,
		private readonly durations: AudioDurations,
		private readonly journal: DeletionJournal,
		private readonly progress: ProgressListener,
	) {}

	async run(options: JobOptions, signal: AbortSignal): Promise<JobReport> {
		const onlyNote = "notePath" in options ? options.notePath : undefined;
		const linesByNote = onlyNote === undefined ? this.matchedNotes(options.rules) : await this.singleNote(onlyNote, options.rules);
		const recoveredDeletions = await this.completePendingDeletions(onlyNote);
		const tasks = await this.withDurations(await this.plan(linesByNote));
		const failures: TaskFailure[] = [];
		let done = 0;
		let cancelled = false;

		this.progress.onStart(tasks);
		for (const [index, task] of tasks.entries()) {
			if (signal.aborted) {
				cancelled = true;
				break;
			}
			this.progress.onTaskStart(index, task);
			try {
				await this.process(task, signal, (fraction) => this.progress.onTaskProgress(index, fraction));
				done++;
				this.progress.onTaskEnd(index, task);
			} catch (error) {
				if (signal.aborted || error instanceof CancelledError) {
					cancelled = true;
					this.progress.onTaskEnd(index, task, "cancelled");
					break;
				}
				const message = error instanceof Error ? error.message : String(error);
				failures.push({ task, message });
				this.progress.onTaskEnd(index, task, message);
			}
		}

		const report: JobReport = { total: tasks.length, done, failures, cancelled, recoveredDeletions };
		this.progress.onFinish(report);
		return report;
	}

	private async plan(linesByNote: Map<string, readonly LineRule[]>): Promise<PlannedTask[]> {
		const tasks: PlannedTask[] = [];
		for (const [notePath, rules] of linesByNote) {
			const content = (await this.vault.readNote(notePath)) ?? "";
			const lines = new AudioLines(rules, this.vault.findAudioEmbeds(notePath));
			const seen = new Set<string>();
			for (const embeds of lines.groups(content)) {
				const key = linkTexts(embeds).join("\n");
				if (seen.has(key)) continue;
				seen.add(key);
				tasks.push({ notePath, embeds, lines });
			}
		}
		return tasks;
	}

	private async singleNote(notePath: string, rules: readonly TranscriptionRule[]): Promise<Map<string, LineRule[]>> {
		if ((await this.vault.readNote(notePath)) === undefined) {
			throw new Error(`note not found: ${notePath}`);
		}
		const valid = rules.flatMap((rule, index) => {
			try {
				return [ValidRule.parse(rule, index + 1)];
			} catch {
				return [];
			}
		});
		const days = this.daysOrNone(valid);
		const names = valid
			.filter((rule) => rule.covers(notePath, days))
			.flatMap((rule) => rule.removedTags?.names ?? []);
		const tags = new InlineTags(names);
		return new Map([[notePath, [{ tagsToRemove: tags.isEmpty ? undefined : tags }]]]);
	}

	/** Which notes the rules select and, per note, the rules that cover it. Every rule is checked before anything is read. */
	private matchedNotes(rules: readonly TranscriptionRule[]): Map<string, LineRule[]> {
		if (rules.length === 0) {
			throw new Error("nothing to transcribe: add a rule in the plugin settings");
		}
		const valid = rules.map((rule, index) => ValidRule.parse(rule, index + 1));
		const days = valid.some((rule) => rule.needsDailyNotes) ? this.days() : new Map<string, string>();
		const linesByNote = new Map<string, LineRule[]>();
		for (const notePath of this.vault.listNotes()) {
			const covering = valid.filter((rule) => rule.covers(notePath, days));
			if (covering.length > 0) linesByNote.set(notePath, covering.map((rule) => rule.lineRule));
		}
		return linesByNote;
	}

	private days(): Map<string, string> {
		return new Map(this.vault.dailyNotes().map((note) => [note.path, note.day]));
	}

	/** For the current note only: daily rules are skipped when daily notes are not set up. */
	private daysOrNone(rules: readonly ValidRule[]): Map<string, string> {
		if (!rules.some((rule) => rule.needsDailyNotes)) return new Map();
		try {
			return this.days();
		} catch {
			return new Map();
		}
	}

	private async withDurations(tasks: PlannedTask[]): Promise<PlannedTask[]> {
		const probed = new Set<string>();
		const result: PlannedTask[] = [];
		for (const task of tasks) {
			let durationSeconds: number | undefined = 0;
			for (const { audioPath } of task.embeds) {
				if (probed.has(audioPath)) continue;
				probed.add(audioPath);
				const seconds = this.vault.exists(audioPath)
					? await this.durations.secondsOf(this.vault.absolutePath(audioPath))
					: undefined;
				durationSeconds = seconds === undefined || durationSeconds === undefined ? undefined : durationSeconds + seconds;
			}
			result.push({ ...task, durationSeconds });
		}
		return result;
	}

	private async process(
		task: PlannedTask,
		signal: AbortSignal,
		onProgress: (fraction: number) => void,
	): Promise<void> {
		const missing = task.embeds.find((embed) => !this.vault.exists(embed.audioPath));
		if (missing) {
			throw new Error(`audio file not found: ${missing.audioPath}`);
		}

		const text = await this.transcriptOfParts(task.embeds, signal, onProgress);
		if (signal.aborted) throw new CancelledError();

		const references = linkTexts(task.embeds);
		for (const { audioPath } of task.embeds) {
			await this.journal.add({ audioPath, notePath: task.notePath, transcript: text });
		}
		let replaced = false;
		await this.vault.editNote(task.notePath, (content) => {
			const updated = task.lines.replace(content, references, text);
			replaced = updated !== content;
			return updated;
		});
		if (!replaced) {
			for (const { audioPath } of task.embeds) await this.journal.remove(audioPath);
			throw new Error(
				`the line with ${references.join(" ")} was changed during transcription; the audio was kept, run again`,
			);
		}
		for (const { audioPath } of task.embeds) await this.trashIfOrphaned(audioPath);
	}

	private async transcriptOfParts(
		embeds: readonly AudioEmbed[],
		signal: AbortSignal,
		onProgress: (fraction: number) => void,
	): Promise<string> {
		const parts = [...new Set(embeds.map((embed) => embed.audioPath))];
		const texts: string[] = [];
		for (const [index, audioPath] of parts.entries()) {
			if (signal.aborted) throw new CancelledError();
			texts.push(await this.transcriptOf(audioPath, signal, (fraction) => onProgress((index + fraction) / parts.length)));
		}
		const text = texts.filter((part) => part.length > 0).join(" ");
		if (text.length === 0) {
			throw new Error("Whisper returned empty text; the audio was kept");
		}
		return text;
	}

	private async transcriptOf(audioPath: string, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<string> {
		const cached = this.transcripts.get(audioPath);
		if (cached !== undefined) return cached;

		const text = (await this.transcriber.transcribe(this.vault.absolutePath(audioPath), signal, onProgress)).trim();
		this.transcripts.set(audioPath, text);
		return text;
	}

	/** Finishes deletions an interrupted run left behind; with `onlyNote`, only those that run made for that note. */
	private async completePendingDeletions(onlyNote?: string): Promise<number> {
		let trashed = 0;
		const entries = this.journal.list().filter((entry) => onlyNote === undefined || entry.notePath === onlyNote);
		for (const entry of entries) {
			const textSaved = (await this.vault.readNote(entry.notePath))?.includes(entry.transcript) ?? false;
			if (!textSaved) {
				await this.journal.remove(entry.audioPath);
				continue;
			}
			if (await this.trashIfOrphaned(entry.audioPath)) trashed++;
		}
		return trashed;
	}

	private async trashIfOrphaned(audioPath: string): Promise<boolean> {
		let trashed = false;
		if (this.vault.exists(audioPath) && !(await this.vault.isReferenced(audioPath))) {
			await this.vault.trash(audioPath);
			trashed = true;
		}
		await this.journal.remove(audioPath);
		return trashed;
	}
}

function linkTexts(embeds: readonly AudioEmbed[]): string[] {
	return embeds.map((embed) => embed.linkText);
}
