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

		const folderSetting = new Setting(containerEl).setName("Папка");
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
			.setName("Теги")
			.setDesc("По одному на строку, без #. Распознаётся только аудио, на строке с которым стоит любой из этих тегов, например «- ![[rec.m4a]] #transcribe». Хотя бы один тег обязателен.")
			.addTextArea((text) =>
				text
					.setPlaceholder("transcribe")
					.setValue(settings.tags.join("\n"))
					.onChange((value) =>
						this.store.updateSettings({ tags: SettingsTab.lines(value).map((t) => t.replace(/^#/, "")) }),
					),
			);

		new Setting(containerEl)
			.setName("Удалять тег после распознавания")
			.setDesc("Снимать тег со строки, в которую вставлен текст.")
			.addToggle((toggle) =>
				toggle.setValue(settings.removeTagsAfter).onChange((value) => this.store.updateSettings({ removeTagsAfter: value })),
			);

		new Setting(containerEl)
			.setName("Движок")
			.setDesc("Оба работают локально, офлайн.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("whisper.cpp", "whisper.cpp (brew install whisper-cpp)")
					.addOption("openai-whisper", "openai-whisper (pip install openai-whisper)")
					.setValue(settings.engine)
					.onChange(async (value) => {
						await this.store.updateSettings({ engine: value as WhisperEngine, whisperPath: "", model: "" });
						this.display();
					}),
			);

		const isCpp = settings.engine === "whisper.cpp";

		new Setting(containerEl)
			.setName("Путь к Whisper")
			.setDesc(`Пусто — искать ${isCpp ? "whisper-cli" : "whisper"} в /opt/homebrew/bin, /usr/local/bin, ~/.local/bin.`)
			.addText((text) =>
				text.setPlaceholder("автоопределение").setValue(settings.whisperPath).onChange((value) => this.store.updateSettings({ whisperPath: value })),
			);

		new Setting(containerEl)
			.setName(isCpp ? "Файл модели" : "Модель")
			.setDesc(
				isCpp
					? "Путь к ggml-*.bin. Пусто — искать в ~/whisper-models (предпочтительно ggml-large-v3-turbo.bin)."
					: "Имя модели: tiny, base, small, medium, large-v3, turbo. Пусто — turbo.",
			)
			.addText((text) =>
				text.setPlaceholder(isCpp ? "~/whisper-models/ggml-large-v3-turbo.bin" : "turbo").setValue(settings.model).onChange((value) => this.store.updateSettings({ model: value })),
			);

		new Setting(containerEl)
			.setName("Путь к ffmpeg")
			.setDesc("Нужен для конвертации аудио. Пусто — автоопределение.")
			.addText((text) =>
				text.setPlaceholder("автоопределение").setValue(settings.ffmpegPath).onChange((value) => this.store.updateSettings({ ffmpegPath: value })),
			);

		new Setting(containerEl)
			.setName("Язык")
			.setDesc("Код языка (ru, en, …) или auto.")
			.addText((text) => text.setValue(settings.language).onChange((value) => this.store.updateSettings({ language: value.trim() })));
	}

	private folderDescription(value: string): string {
		const hint = "Где искать заметки с аудио, вложенные папки тоже обрабатываются.";
		const folder = value.trim();
		if (!folder) return `${hint} Обязательно.`;
		const exists = this.app.vault.getAbstractFileByPath(normalizePath(folder)) instanceof TFolder;
		return exists ? hint : `⚠ Папка «${folder}» не найдена.`;
	}

	private static lines(value: string): string[] {
		return value.split("\n").map((line) => line.trim()).filter(Boolean);
	}
}
