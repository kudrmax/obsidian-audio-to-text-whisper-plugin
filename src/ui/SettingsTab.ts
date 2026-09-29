import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PluginStore } from "../infrastructure/PluginStore";
import { WhisperEngine } from "../settings";

export class SettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin, private readonly store: PluginStore) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		const settings = this.store.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Папки")
			.setDesc("Где искать заметки с аудио. По одной на строку, вложенные папки тоже обрабатываются. «/» — весь vault. Без папок плагин не запускается.")
			.addTextArea((text) =>
				text
					.setPlaceholder("Inbox\nJournal/Voice")
					.setValue(settings.folders.join("\n"))
					.onChange((value) => this.store.updateSettings({ folders: SettingsTab.lines(value) })),
			);

		new Setting(containerEl)
			.setName("Теги")
			.setDesc("По одному на строку, без #. Обрабатываются только заметки с любым из этих тегов. Хотя бы один тег обязателен.")
			.addTextArea((text) =>
				text
					.setPlaceholder("transcribe")
					.setValue(settings.tags.join("\n"))
					.onChange((value) =>
						this.store.updateSettings({ tags: SettingsTab.lines(value).map((t) => t.replace(/^#/, "")) }),
					),
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

	private static lines(value: string): string[] {
		return value.split("\n").map((line) => line.trim()).filter(Boolean);
	}
}
