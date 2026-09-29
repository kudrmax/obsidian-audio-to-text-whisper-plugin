import {
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
}

class CancelledError extends Error {}

/**
 * Per-audio order is what makes a run safe to interrupt at any point:
 * transcribe → journal the pending deletion → replace embed in note → trash orphaned audio → clear journal.
 * The audio is trashed only when nothing references it anymore, so it can never be lost before its text is saved.
 */
export class TranscriptionJob {
	private readonly transcripts = new Map<string, string>();

	constructor(
		private readonly vault: VaultGateway,
		private readonly transcriber: Transcriber,
		private readonly journal: DeletionJournal,
		private readonly progress: ProgressListener,
	) {}

	async run(options: JobOptions, signal: AbortSignal): Promise<JobReport> {
		if (options.folders.length === 0) {
			throw new Error("не указаны папки для поиска аудио");
		}
		if (options.tags.length === 0) {
			throw new Error("не указан ни один тег: распознаются только заметки с тегом");
		}
		const recoveredDeletions = await this.completePendingDeletions();
		const tasks = this.collectTasks(options);
		const failures: TaskFailure[] = [];
		let done = 0;
		let cancelled = false;

		this.progress.onStart(tasks.length);
		for (const [index, task] of tasks.entries()) {
			if (signal.aborted) {
				cancelled = true;
				break;
			}
			this.progress.onTaskStart(index, tasks.length, task);
			try {
				await this.process(task, signal);
				done++;
				this.progress.onTaskEnd(index, tasks.length, task);
			} catch (error) {
				if (signal.aborted || error instanceof CancelledError) {
					cancelled = true;
					this.progress.onTaskEnd(index, tasks.length, task, "отменено");
					break;
				}
				const message = error instanceof Error ? error.message : String(error);
				failures.push({ task, message });
				this.progress.onTaskEnd(index, tasks.length, task, message);
			}
		}

		const report: JobReport = { total: tasks.length, done, failures, cancelled, recoveredDeletions };
		this.progress.onFinish(report);
		return report;
	}

	private collectTasks(options: JobOptions): TranscriptionTask[] {
		const tasks: TranscriptionTask[] = [];
		for (const notePath of this.vault.findNotes(options.folders, options.tags)) {
			const seen = new Set<string>();
			for (const embed of this.vault.findAudioEmbeds(notePath)) {
				if (seen.has(embed.linkText)) continue;
				seen.add(embed.linkText);
				tasks.push({ notePath, embed });
			}
		}
		return tasks;
	}

	private async process(task: TranscriptionTask, signal: AbortSignal): Promise<void> {
		const { audioPath, linkText } = task.embed;
		if (!this.vault.exists(audioPath)) {
			throw new Error(`аудиофайл не найден: ${audioPath}`);
		}

		const text = await this.transcriptOf(audioPath, signal);
		if (signal.aborted) throw new CancelledError();

		await this.journal.add({ audioPath, notePath: task.notePath, transcript: text });
		const replaced = await this.vault.replaceInNote(task.notePath, linkText, text);
		if (!replaced) {
			await this.journal.remove(audioPath);
			throw new Error(`ссылка ${linkText} не найдена в заметке, текст не вставлен`);
		}
		await this.trashIfOrphaned(audioPath);
	}

	private async transcriptOf(audioPath: string, signal: AbortSignal): Promise<string> {
		const cached = this.transcripts.get(audioPath);
		if (cached !== undefined) return cached;

		const text = (await this.transcriber.transcribe(this.vault.absolutePath(audioPath), signal)).trim();
		if (text.length === 0) {
			throw new Error("Whisper вернул пустой текст, аудио оставлено как есть");
		}
		this.transcripts.set(audioPath, text);
		return text;
	}

	private async completePendingDeletions(): Promise<number> {
		let trashed = 0;
		for (const entry of this.journal.list()) {
			const textSaved = await this.vault.noteContains(entry.notePath, entry.transcript);
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
