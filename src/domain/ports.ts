export interface AudioEmbed {
	readonly linkText: string;
	readonly audioPath: string;
}

export interface TranscriptionTask {
	readonly notePath: string;
	readonly embed: AudioEmbed;
	/** Zero for repeated references to already transcribed audio; undefined when the duration is unknown. */
	readonly durationSeconds?: number;
}

export interface VaultGateway {
	findNotes(folders: readonly string[], tags: readonly string[]): string[];
	findAudioEmbeds(notePath: string): AudioEmbed[];
	exists(path: string): boolean;
	absolutePath(path: string): string;
	readNote(notePath: string): Promise<string | undefined>;
	/** Atomic read-modify-write against the note's current content. */
	editNote(notePath: string, edit: (content: string) => string): Promise<void>;
	isReferenced(audioPath: string): Promise<boolean>;
	trash(path: string): Promise<void>;
}

export interface Transcriber {
	transcribe(absoluteAudioPath: string, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<string>;
}

export interface AudioDurations {
	secondsOf(absoluteAudioPath: string): Promise<number | undefined>;
}

export interface PendingDeletion {
	readonly audioPath: string;
	readonly notePath: string;
	readonly transcript: string;
}

export interface DeletionJournal {
	list(): PendingDeletion[];
	add(entry: PendingDeletion): Promise<void>;
	remove(audioPath: string): Promise<void>;
}

export interface TaskFailure {
	readonly task: TranscriptionTask;
	readonly message: string;
}

export interface JobReport {
	readonly total: number;
	readonly done: number;
	readonly failures: readonly TaskFailure[];
	readonly cancelled: boolean;
	readonly recoveredDeletions: number;
}

export interface ProgressListener {
	onStart(tasks: readonly TranscriptionTask[]): void;
	onTaskStart(index: number, task: TranscriptionTask): void;
	onTaskProgress(index: number, fraction: number): void;
	onTaskEnd(index: number, task: TranscriptionTask, error?: string): void;
	onFinish(report: JobReport): void;
}
