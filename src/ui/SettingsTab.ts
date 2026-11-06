import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PluginStore } from "../infrastructure/PluginStore";
import { WhisperEngine } from "../settings";
import { RulesSection } from "./RulesSection";

export class SettingsTab extends PluginSettingTab {
	constructor(app: App, plugin: Plugin, private readonly store: PluginStore) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new RulesSection(this.app, this.store, () => this.display()).display(containerEl);
		new Setting(containerEl).setName("Whisper").setHeading();
		this.displayEngine(containerEl);
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
}
