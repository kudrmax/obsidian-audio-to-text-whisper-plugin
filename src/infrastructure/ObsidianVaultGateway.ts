import { App, FileSystemAdapter, TFile, getAllTags, getLinkpath, normalizePath } from "obsidian";
import { AudioEmbed, VaultGateway } from "../domain/ports";
import { replaceReference } from "../domain/replaceReference";

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "oga", "opus", "webm", "flac", "aac", "3gp", "mp4"]);

export class ObsidianVaultGateway implements VaultGateway {
	constructor(private readonly app: App) {}

	findNotes(folders: readonly string[], tags: readonly string[]): string[] {
		const prefixes = folders.map((f) => normalizePath(f));
		const wanted = new Set(tags.map((t) => `#${t.replace(/^#/, "").toLowerCase()}`));
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => prefixes.some((p) => p === "/" || file.path.startsWith(`${p}/`)))
			.filter((file) => this.tagsOf(file).some((t) => wanted.has(t)))
			.map((file) => file.path);
	}

	findAudioEmbeds(notePath: string): AudioEmbed[] {
		const cache = this.app.metadataCache.getCache(notePath);
		const references = [...(cache?.embeds ?? []), ...(cache?.links ?? [])];
		const result: AudioEmbed[] = [];
		for (const reference of references) {
			const target = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(reference.link), notePath);
			if (target && AUDIO_EXTENSIONS.has(target.extension.toLowerCase())) {
				result.push({ linkText: reference.original, audioPath: target.path });
			}
		}
		return result;
	}

	exists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
	}

	absolutePath(path: string): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("плагин работает только в десктопной версии Obsidian");
		}
		return adapter.getFullPath(path);
	}

	async replaceInNote(notePath: string, search: string, replacement: string): Promise<boolean> {
		let replaced = false;
		await this.app.vault.process(this.file(notePath), (content) => {
			const updated = replaceReference(content, search, replacement);
			replaced = updated !== content;
			return updated;
		});
		return replaced;
	}

	async noteContains(notePath: string, text: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		return file instanceof TFile && (await this.app.vault.read(file)).includes(text);
	}

	/** Conservative on purpose: any mention of the file name counts as a reference, so audio is never trashed by mistake. */
	async isReferenced(audioPath: string): Promise<boolean> {
		const audio = this.file(audioPath);
		const needles = [audio.name, encodeURI(audio.name), audio.name.replace(/ /g, "%20")];
		for (const source of this.sourcesLinkingTo(audioPath)) {
			const note = this.app.vault.getAbstractFileByPath(source);
			if (!(note instanceof TFile)) continue;
			const content = await this.app.vault.read(note);
			if (needles.some((n) => content.includes(n))) return true;
		}
		return false;
	}

	async trash(path: string): Promise<void> {
		await this.app.vault.trash(this.file(path), true);
	}

	private tagsOf(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		return (cache ? getAllTags(cache) ?? [] : []).map((t) => t.toLowerCase());
	}

	private sourcesLinkingTo(path: string): string[] {
		const resolved = this.app.metadataCache.resolvedLinks;
		return Object.keys(resolved).filter((source) => resolved[source]?.[path] !== undefined);
	}

	private file(path: string): TFile {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`файл не найден: ${path}`);
		return file;
	}
}
