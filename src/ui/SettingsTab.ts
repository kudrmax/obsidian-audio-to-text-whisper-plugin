import { App, Plugin, PluginSettingTab, Setting, TFolder, normalizePath } from "obsidian";
import { dailyNotesConfig } from "../infrastructure/ObsidianDailyNotes";
import { PluginStore } from "../infrastructure/PluginStore";
import { WhisperEngine } from "../settings";
import { FolderSuggest } from "./FolderSuggest";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin, private readonly store: PluginStore) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const settings = this.store.settings;
		new Setting(containerEl)
			.setName("What to transcribe")
			.setDesc("Audio is picked by two rules. Turn on one or both; a note matched by either rule is transcribed.")
			.setHeading();
		this.displayTagRuleToggle(containerEl);
		this.displayDateRuleToggle(containerEl);
		if (settings.transcribeTagged) this.displayTagRuleSettings(containerEl);
		if (settings.transcribeDailyNotes) this.displayDateRuleSettings(containerEl);
		new Setting(containerEl).setName("Whisper").setHeading();
		this.displayEngine(containerEl);
	}

	private displayTagRuleToggle(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("By tag")
			.setDesc("Audio with one of the tags on its line, in the chosen folder.")
			.addToggle((toggle) =>
				toggle.setValue(this.store.settings.transcribeTagged).onChange(async (value) => {
					await this.store.updateSettings({ transcribeTagged: value });
					this.display();
				}),
			);
	}

	private displayDateRuleToggle(containerEl: HTMLElement): void {
		const config = dailyNotesConfig(this.app);
		const desc = config
			? `Every audio in daily notes dated on or after a day, no tag needed. Daily notes: "${config.folder || "/"}" notes named ${config.format}, as set in Obsidian's Daily notes plugin.`
			: "⚠ Enable the Daily notes core plugin in Obsidian first.";
		new Setting(containerEl)
			.setName("By daily note date")
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle.setValue(this.store.settings.transcribeDailyNotes).onChange(async (value) => {
					const dailyNotesFrom = this.store.settings.dailyNotesFrom || SettingsTab.today();
					await this.store.updateSettings({ transcribeDailyNotes: value, dailyNotesFrom });
					this.display();
				}),
			);
	}

	private displayTagRuleSettings(containerEl: HTMLElement): void {
		const settings = this.store.settings;
		new Setting(containerEl).setName("By tag: settings").setHeading();

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
	}

	private displayDateRuleSettings(containerEl: HTMLElement): void {
		const settings = this.store.settings;
		new Setting(containerEl).setName("By daily note date: settings").setHeading();

		const hint = "Daily notes dated before this day are never touched.";
		const dateSetting = new Setting(containerEl).setName("From date").setDesc(hint);
		dateSetting.addText((text) => {
			text.inputEl.type = "date";
			text.setValue(settings.dailyNotesFrom).onChange(async (value) => {
				if (!SettingsTab.isDate(value)) {
					dateSetting.setDesc(`⚠ Enter a day as YYYY-MM-DD; the last valid one, ${this.store.settings.dailyNotesFrom}, stays in effect.`);
					return;
				}
				dateSetting.setDesc(hint);
				await this.store.updateSettings({ dailyNotesFrom: value });
			});
		});
	}

	private displayEngine(containerEl: HTMLElement): void {
		const settings = this.store.settings;
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

		if (isCpp) {
			new Setting(containerEl)
				.setName("VAD model file")
				.setDesc(
					"Path to a ggml-silero-*.bin voice activity detection model downloaded beforehand. It keeps Whisper from inventing text on silence and quiet speech. Leave empty to look in ~/whisper-models.",
				)
				.addText((text) =>
					text
						.setPlaceholder("~/whisper-models/ggml-silero-v5.1.2.bin")
						.setValue(settings.vadModel)
						.onChange((value) => this.store.updateSettings({ vadModel: value })),
				);
		}

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

	private static isDate(value: string): boolean {
		return ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
	}

	private static today(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	}

	private static lines(value: string): string[] {
		return value.split("\n").map((line) => line.trim()).filter(Boolean);
	}
}
