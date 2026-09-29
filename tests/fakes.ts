import { replaceReference } from "../src/domain/replaceReference";
import {
	AudioEmbed,
	DeletionJournal,
	JobReport,
	PendingDeletion,
	ProgressListener,
	Transcriber,
	VaultGateway,
} from "../src/domain/ports";

interface FakeNote {
	content: string;
	tags: string[];
}

export class FakeVault implements VaultGateway {
	readonly notes = new Map<string, FakeNote>();
	readonly audio = new Set<string>();
	readonly trashed: string[] = [];
	failOnReplace = false;
	failOnTrash = false;

	addNote(path: string, content: string, tags: string[] = []): this {
		this.notes.set(path, { content, tags });
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
			.filter(([, note]) => note.tags.some((t) => tags.includes(t)))
			.map(([path]) => path);
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

	async replaceInNote(notePath: string, search: string, replacement: string): Promise<boolean> {
		if (this.failOnReplace) throw new Error("crash on replace");
		const note = this.notes.get(notePath)!;
		const updated = replaceReference(note.content, search, replacement);
		const replaced = updated !== note.content;
		note.content = updated;
		return replaced;
	}

	async noteContains(notePath: string, text: string): Promise<boolean> {
		return this.notes.get(notePath)?.content.includes(text) ?? false;
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

	async transcribe(absoluteAudioPath: string): Promise<string> {
		this.calls.push(absoluteAudioPath);
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

export class RecordingProgress implements ProgressListener {
	readonly events: string[] = [];
	report?: JobReport;

	onStart(total: number): void {
		this.events.push(`start ${total}`);
	}

	onTaskStart(index: number, total: number): void {
		this.events.push(`task ${index + 1}/${total}`);
	}

	onTaskEnd(index: number, total: number, _task: unknown, error?: string): void {
		this.events.push(`end ${index + 1}/${total}${error ? ` error` : ""}`);
	}

	onFinish(report: JobReport): void {
		this.report = report;
	}
}
