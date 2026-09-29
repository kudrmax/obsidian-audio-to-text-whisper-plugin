import { App, Plugin, PluginSettingTab, Setting, TFolder, normalizePath } from "obsidian";
import { PluginStore } from "../infrastructure/PluginStore";
import { WhisperEngine } from "../settings";
import { FolderSuggest } from "./FolderSuggest";

export class SettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin, private readonly store: PluginStore) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		const settings = this.store.settings;
		containerEl.empty();

		const folderSetting = new Setting(containerEl).setName("Folder");
		const describeFolder = (value: string) => folderSetting.setDesc(this.folderDescription(value));
		folderSetting.addText((text) => {
			new FolderSuggest(this.app, text.inputEl);
			text
				.setPlaceholder("Daily")
				.setValue(settings.folder)
				.onChange(async (value) => {
					describeFolder(value);
					await this.store.updateSettings({ folder: value.trim() });
				});
		});
		describeFolder(settings.folder);

		new Setting(containerEl)
			.setName("Tags")
			.setDesc(
				"One per line, without #. Only audio with any of these tags on the same line is transcribed, e.g. \"- ![[rec.m4a]] #transcribe\". At least one tag is required.",
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("transcribe")
					.setValue(settings.tags.join("\n"))
					.onChange((value) =>
						this.store.updateSettings({ tags: SettingsTab.lines(value).map((t) => t.replace(/^#/, "")) }),
					),
			);

		new Setting(containerEl)
			.setName("Remove tag after transcription")
			.setDesc("Remove the tag from the line where the text was inserted.")
			.addToggle((toggle) =>
				toggle.setValue(settings.removeTagsAfter).onChange((value) => this.store.updateSettings({ removeTagsAfter: value })),
			);

		new Setting(containerEl)
			.setName("Engine")
			.setDesc("Both run locally and offline.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("whisper.cpp", "whisper.cpp (brew install whisper-cpp)")
					.addOption("openai-whisper", "openai-whisper (pipx install openai-whisper)")
					.setValue(settings.engine)
					.onChange(async (value) => {
						await this.store.updateSettings({ engine: value as WhisperEngine, whisperPath: "", model: "" });
						this.display();
					}),
			);

		const isCpp = settings.engine === "whisper.cpp";

		new Setting(containerEl)
			.setName("Whisper executable")
			.setDesc(`Leave empty to look for ${isCpp ? "whisper-cli" : "whisper"} in /opt/homebrew/bin, /usr/local/bin, ~/.local/bin.`)
			.addText((text) =>
				text.setPlaceholder("auto-detect").setValue(settings.whisperPath).onChange((value) => this.store.updateSettings({ whisperPath: value })),
			);

		new Setting(containerEl)
			.setName("Model file")
			.setDesc(
				isCpp
					? "Path to a ggml-*.bin model downloaded beforehand. Leave empty to look in ~/whisper-models (ggml-large-v3-turbo.bin preferred)."
					: "Path to a .pt model downloaded beforehand. Leave empty to look in ~/.cache/whisper (large-v3-turbo.pt preferred). The plugin never downloads models.",
			)
			.addText((text) =>
				text
					.setPlaceholder(isCpp ? "~/whisper-models/ggml-large-v3-turbo.bin" : "~/.cache/whisper/large-v3-turbo.pt")
					.setValue(settings.model)
					.onChange((value) => this.store.updateSettings({ model: value })),
			);

		new Setting(containerEl)
			.setName("ffmpeg executable")
			.setDesc("Used to convert audio and read its duration. Leave empty to auto-detect.")
			.addText((text) =>
				text.setPlaceholder("auto-detect").setValue(settings.ffmpegPath).onChange((value) => this.store.updateSettings({ ffmpegPath: value })),
			);

		new Setting(containerEl)
			.setName("Language")
			.setDesc("Language code (en, ru, …) or auto.")
			.addText((text) => text.setValue(settings.language).onChange((value) => this.store.updateSettings({ language: value.trim() })));
	}

	private folderDescription(value: string): string {
		const hint = "Where to look for notes with audio, including subfolders.";
		const folder = value.trim();
		if (!folder) return `${hint} Required.`;
		const exists = this.app.vault.getAbstractFileByPath(normalizePath(folder)) instanceof TFolder;
		return exists ? hint : `⚠ Folder "${folder}" not found.`;
	}

	private static lines(value: string): string[] {
		return value.split("\n").map((line) => line.trim()).filter(Boolean);
	}
}
