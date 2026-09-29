export interface AudioEmbed {
	readonly linkText: string;
	readonly audioPath: string;
}

export interface TranscriptionTask {
	readonly notePath: string;
	readonly embed: AudioEmbed;
}

export interface VaultGateway {
	findNotes(folders: readonly string[], tags: readonly string[]): string[];
	findAudioEmbeds(notePath: string): AudioEmbed[];
	exists(path: string): boolean;
	absolutePath(path: string): string;
	replaceInNote(notePath: string, search: string, replacement: string): Promise<boolean>;
	noteContains(notePath: string, text: string): Promise<boolean>;
	isReferenced(audioPath: string): Promise<boolean>;
	trash(path: string): Promise<void>;
}

export interface Transcriber {
	transcribe(absoluteAudioPath: string, signal: AbortSignal): Promise<string>;
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
	onStart(total: number): void;
	onTaskStart(index: number, total: number, task: TranscriptionTask): void;
	onTaskEnd(index: number, total: number, task: TranscriptionTask, error?: string): void;
	onFinish(report: JobReport): void;
}
