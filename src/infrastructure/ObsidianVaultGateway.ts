import { App, FileSystemAdapter, TFile, getAllTags, getLinkpath, normalizePath } from "obsidian";
import { AudioEmbed, VaultGateway } from "../domain/ports";

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "ogg", "oga", "opus", "webm", "flac", "aac", "3gp", "mp4"]);

export class ObsidianVaultGateway implements VaultGateway {
	constructor(private readonly app: App) {}

	findTaggedNotes(folders: readonly string[], tag: string): string[] {
		const wanted = `#${tag.replace(/^#/, "").toLowerCase()}`;
		const prefixes = folders.map((f) => normalizePath(f)).filter((f) => f !== "/" && f !== "");
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => prefixes.length === 0 || prefixes.some((p) => file.path.startsWith(`${p}/`)))
			.filter((file) => {
				const cache = this.app.metadataCache.getFileCache(file);
				const tags = cache ? getAllTags(cache) ?? [] : [];
				return tags.some((t) => t.toLowerCase() === wanted);
			})
			.map((file) => file.path);
	}

	findAudioEmbeds(notePath: string): AudioEmbed[] {
		const embeds = this.app.metadataCache.getCache(notePath)?.embeds ?? [];
		const result: AudioEmbed[] = [];
		for (const embed of embeds) {
			const target = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(embed.link), notePath);
			if (target && AUDIO_EXTENSIONS.has(target.extension.toLowerCase())) {
				result.push({ linkText: embed.original, audioPath: target.path });
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
			if (!content.includes(search)) return content;
			replaced = true;
			return content.split(search).join(replacement);
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
