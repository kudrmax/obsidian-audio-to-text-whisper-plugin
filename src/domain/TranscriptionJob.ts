import { InlineTags } from "./InlineTags";
import { TaggedAudioLines } from "./TaggedAudioLines";
import {
	AudioDurations,
	DeletionJournal,
	JobReport,
	ProgressListener,
	TaskFailure,
	Transcriber,
	TranscriptionTask,
	VaultGateway,
} from "./ports";

export interface JobOptions {
	readonly folders: readonly string[];
	readonly tags: readonly string[];
	readonly removeTagsAfter: boolean;
}

class CancelledError extends Error {}

/**
 * Only audio references with a tag on the same line are processed.
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
		if (options.folders.length === 0) {
			throw new Error("no folder configured to search for audio");
		}
		const tags = new InlineTags(options.tags);
		if (tags.isEmpty) {
			throw new Error("no tag configured: only audio marked with a tag is transcribed");
		}
		const lines = new TaggedAudioLines(tags, options.removeTagsAfter);
		const recoveredDeletions = await this.completePendingDeletions();
		const tasks = await this.withDurations(await this.collectTasks(options, lines));
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
				await this.process(task, lines, signal, (fraction) => this.progress.onTaskProgress(index, fraction));
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

	private async collectTasks(options: JobOptions, lines: TaggedAudioLines): Promise<TranscriptionTask[]> {
		const tasks: TranscriptionTask[] = [];
		for (const notePath of this.vault.findNotes(options.folders, options.tags)) {
			const content = (await this.vault.readNote(notePath)) ?? "";
			const seen = new Set<string>();
			for (const embed of this.vault.findAudioEmbeds(notePath)) {
				if (seen.has(embed.linkText) || !lines.contains(content, embed.linkText)) continue;
				seen.add(embed.linkText);
				tasks.push({ notePath, embed });
			}
		}
		return tasks;
	}

	private async withDurations(tasks: TranscriptionTask[]): Promise<TranscriptionTask[]> {
		const probed = new Set<string>();
		const result: TranscriptionTask[] = [];
		for (const task of tasks) {
			const { audioPath } = task.embed;
			if (probed.has(audioPath)) {
				result.push({ ...task, durationSeconds: 0 });
				continue;
			}
			probed.add(audioPath);
			const durationSeconds = this.vault.exists(audioPath)
				? await this.durations.secondsOf(this.vault.absolutePath(audioPath))
				: undefined;
			result.push({ ...task, durationSeconds });
		}
		return result;
	}

	private async process(
		task: TranscriptionTask,
		lines: TaggedAudioLines,
		signal: AbortSignal,
		onProgress: (fraction: number) => void,
	): Promise<void> {
		const { audioPath, linkText } = task.embed;
		if (!this.vault.exists(audioPath)) {
			throw new Error(`audio file not found: ${audioPath}`);
		}

		const text = await this.transcriptOf(audioPath, signal, onProgress);
		if (signal.aborted) throw new CancelledError();

		await this.journal.add({ audioPath, notePath: task.notePath, transcript: text });
		let replaced = false;
		await this.vault.editNote(task.notePath, (content) => {
			const updated = lines.replace(content, linkText, text);
			replaced = updated !== content;
			return updated;
		});
		if (!replaced) {
			await this.journal.remove(audioPath);
			throw new Error(
				`the line with ${linkText} and the tag was changed during transcription; the audio was kept, run again`,
			);
		}
		await this.trashIfOrphaned(audioPath);
	}

	private async transcriptOf(audioPath: string, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<string> {
		const cached = this.transcripts.get(audioPath);
		if (cached !== undefined) return cached;

		const text = (await this.transcriber.transcribe(this.vault.absolutePath(audioPath), signal, onProgress)).trim();
		if (text.length === 0) {
			throw new Error("Whisper returned empty text; the audio was kept");
		}
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
