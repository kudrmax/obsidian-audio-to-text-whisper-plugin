import { AllAudioLines } from "./AllAudioLines";
import { AudioLines } from "./AudioLines";
import { InlineTags } from "./InlineTags";
import { TaggedAudioLines } from "./TaggedAudioLines";
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

export interface TagRule {
	readonly folders: readonly string[];
	readonly tags: readonly string[];
	readonly removeTagsAfter: boolean;
}

/** At least one rule is required; a note matched by both is processed once, with every audio in it. */
export interface JobOptions {
	readonly tagged?: TagRule;
	/** Daily notes dated on or after this day (YYYY-MM-DD) are processed whole, no tag needed. */
	readonly dailyNotesFrom?: string;
}

interface PlannedTask extends TranscriptionTask {
	readonly lines: AudioLines;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

class CancelledError extends Error {}

/**
 * Audio is selected by a tag on its line and/or by the date of the daily note it stands in.
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
		const recoveredDeletions = await this.completePendingDeletions();
		const tasks = await this.withDurations(await this.plan(options));
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

	/** Which notes to process and, per note, which of their audio lines. The date rule covers a note whole, so it wins. */
	private async plan(options: JobOptions): Promise<PlannedTask[]> {
		if (!options.tagged && options.dailyNotesFrom === undefined) {
			throw new Error("nothing to transcribe: enable Tagged audio or Daily notes from a date in settings");
		}
		const linesByNote = new Map<string, AudioLines>();
		const tags = options.tagged && this.tagsOf(options.tagged);
		if (options.tagged && tags) {
			const lines = new TaggedAudioLines(tags, options.tagged.removeTagsAfter);
			for (const notePath of this.vault.findNotes(options.tagged.folders, options.tagged.tags)) {
				linesByNote.set(notePath, lines);
			}
		}
		if (options.dailyNotesFrom !== undefined) {
			const tagsToRemove = options.tagged?.removeTagsAfter ? tags : undefined;
			const lines = new AllAudioLines(tagsToRemove);
			for (const notePath of this.vault.findDailyNotes(this.validDate(options.dailyNotesFrom))) {
				linesByNote.set(notePath, lines);
			}
		}
		const tasks: PlannedTask[] = [];
		for (const [notePath, lines] of linesByNote) {
			const content = (await this.vault.readNote(notePath)) ?? "";
			const seen = new Set<string>();
			for (const embeds of lines.groups(content, this.vault.findAudioEmbeds(notePath))) {
				const key = linkTexts(embeds).join("\n");
				if (seen.has(key)) continue;
				seen.add(key);
				tasks.push({ notePath, embeds, lines });
			}
		}
		return tasks;
	}

	private tagsOf(rule: TagRule): InlineTags {
		if (rule.folders.length === 0) {
			throw new Error("no folder configured to search for tagged audio");
		}
		const tags = new InlineTags(rule.tags);
		if (tags.isEmpty) {
			throw new Error("no tag configured: Tagged audio transcribes only audio marked with a tag");
		}
		return tags;
	}

	private validDate(date: string): string {
		if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) {
			throw new Error(`"${date}" is not a date in the YYYY-MM-DD form`);
		}
		return date;
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
		const texts: string[] = [];
		for (const [index, { audioPath }] of embeds.entries()) {
			if (signal.aborted) throw new CancelledError();
			texts.push(await this.transcriptOf(audioPath, signal, (fraction) => onProgress((index + fraction) / embeds.length)));
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

	private async completePendingDeletions(): Promise<number> {
		let trashed = 0;
		for (const entry of this.journal.list()) {
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
