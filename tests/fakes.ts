import { InlineTags } from "../src/domain/InlineTags";
import {
	AudioDurations,
	AudioEmbed,
	DeletionJournal,
	JobReport,
	PendingDeletion,
	ProgressListener,
	Transcriber,
	TranscriptionTask,
	VaultGateway,
} from "../src/domain/ports";

interface FakeNote {
	content: string;
}

export class FakeVault implements VaultGateway {
	readonly notes = new Map<string, FakeNote>();
	readonly audio = new Set<string>();
	readonly trashed: string[] = [];
	failOnEdit = false;
	editDuringTranscription?: (content: string) => string;
	failOnTrash = false;

	addNote(path: string, content: string): this {
		this.notes.set(path, { content });
		return this;
	}

	addAudio(path: string): this {
		this.audio.add(path);
		return this;
	}

	content(path: string): string {
		return this.notes.get(path)!.content;
	}

	findNotes(folders: readonly string[], tags: readonly string[]): string[] {
		return [...this.notes.entries()]
			.filter(([path]) => folders.some((f) => path.startsWith(`${f}/`)))
			.filter(([, note]) => new InlineTags(tags).matches(note.content))
			.map(([path]) => path);
	}

	findDailyNotes(fromDate: string): string[] {
		const folder = "Journal/Daily notes/";
		return [...this.notes.keys()]
			.filter((path) => path.startsWith(folder))
			.filter((path) => path.slice(folder.length, -3) >= fromDate);
	}

	findAudioEmbeds(notePath: string): AudioEmbed[] {
		const matches = this.content(notePath).matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g);
		return [...matches]
			.map((m) => ({ linkText: m[0], audioPath: this.resolve(m[1]) }))
			.filter((e): e is AudioEmbed => e.audioPath !== undefined);
	}

	exists(path: string): boolean {
		return this.audio.has(path);
	}

	absolutePath(path: string): string {
		return `/vault/${path}`;
	}

	async readNote(notePath: string): Promise<string | undefined> {
		return this.notes.get(notePath)?.content;
	}

	async editNote(notePath: string, edit: (content: string) => string): Promise<void> {
		if (this.failOnEdit) throw new Error("crash on edit");
		const note = this.notes.get(notePath);
		if (!note) throw new Error(`note not found: ${notePath}`);
		if (this.editDuringTranscription) note.content = this.editDuringTranscription(note.content);
		note.content = edit(note.content);
	}

	async isReferenced(audioPath: string): Promise<boolean> {
		const name = audioPath.split("/").pop()!;
		return [...this.notes.values()].some((n) => n.content.includes(name));
	}

	async trash(path: string): Promise<void> {
		if (this.failOnTrash) throw new Error("crash on trash");
		this.audio.delete(path);
		this.trashed.push(path);
	}

	private resolve(link: string): string | undefined {
		return [...this.audio].find((p) => p === link || p.endsWith(`/${link}`));
	}
}

export class FakeTranscriber implements Transcriber {
	readonly calls: string[] = [];
	private readonly failing = new Set<string>();

	constructor(private readonly texts: Record<string, string> = {}) {}

	failFor(absolutePath: string): this {
		this.failing.add(absolutePath);
		return this;
	}

	async transcribe(absoluteAudioPath: string, _signal: AbortSignal, onProgress: (fraction: number) => void): Promise<string> {
		this.calls.push(absoluteAudioPath);
		onProgress(0.5);
		if (this.failing.has(absoluteAudioPath)) throw new Error("whisper failed");
		return this.texts[absoluteAudioPath] ?? `text of ${absoluteAudioPath.split("/").pop()!.split(".")[0]}`;
	}
}

export class MemoryJournal implements DeletionJournal {
	private readonly entries = new Map<string, PendingDeletion>();

	list(): PendingDeletion[] {
		return [...this.entries.values()];
	}

	async add(entry: PendingDeletion): Promise<void> {
		this.entries.set(entry.audioPath, entry);
	}

	async remove(audioPath: string): Promise<void> {
		this.entries.delete(audioPath);
	}
}

export class FixedDurations implements AudioDurations {
	constructor(private readonly seconds: Record<string, number> = {}) {}

	async secondsOf(absoluteAudioPath: string): Promise<number | undefined> {
		return this.seconds[absoluteAudioPath];
	}
}

export class RecordingProgress implements ProgressListener {
	readonly events: string[] = [];
	started: readonly TranscriptionTask[] = [];
	report?: JobReport;

	onStart(tasks: readonly TranscriptionTask[]): void {
		this.started = tasks;
		this.events.push(`start ${tasks.length}`);
	}

	onTaskStart(index: number): void {
		this.events.push(`task ${index + 1}`);
	}

	onTaskProgress(index: number, fraction: number): void {
		this.events.push(`progress ${index + 1} ${fraction}`);
	}

	onTaskEnd(index: number, _task: TranscriptionTask, error?: string): void {
		this.events.push(`end ${index + 1}${error ? " error" : ""}`);
	}

	onFinish(report: JobReport): void {
		this.report = report;
	}
}
