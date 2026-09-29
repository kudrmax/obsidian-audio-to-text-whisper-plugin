import { Notice, Plugin } from "obsidian";
import { TranscriptionJob } from "./domain/TranscriptionJob";
import { ObsidianVaultGateway } from "./infrastructure/ObsidianVaultGateway";
import { PluginStore } from "./infrastructure/PluginStore";
import { TranscriberFactory } from "./infrastructure/transcribers/TranscriberFactory";
import { ProgressNotice } from "./ui/ProgressNotice";
import { SettingsTab } from "./ui/SettingsTab";

export default class WhisperTranscriberPlugin extends Plugin {
	private readonly store = new PluginStore(this);
	private running?: AbortController;
	private statusBar!: HTMLElement;

	override async onload(): Promise<void> {
		await this.store.load();
		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new SettingsTab(this.app, this, this.store));
		this.addRibbonIcon("mic", "Распознать аудио (Whisper)", () => void this.transcribe());
		this.addCommand({ id: "transcribe", name: "Распознать аудио в заметках", callback: () => void this.transcribe() });
		this.addCommand({
			id: "cancel",
			name: "Остановить распознавание",
			checkCallback: (checking) => {
				if (!this.running) return false;
				if (!checking) this.running.abort();
				return true;
			},
		});
	}

	override onunload(): void {
		this.running?.abort();
	}

	private async transcribe(): Promise<void> {
		if (this.running) {
			new Notice("Whisper: распознавание уже идёт");
			return;
		}
		const settings = this.store.settings;

		this.running = new AbortController();
		try {
			const job = new TranscriptionJob(
				new ObsidianVaultGateway(this.app),
				TranscriberFactory.create(settings),
				this.store,
				new ProgressNotice(this.statusBar),
			);
			await job.run({ folders: settings.folders, tags: settings.tags }, this.running.signal);
		} catch (error) {
			new Notice(`Whisper: ${error instanceof Error ? error.message : String(error)}`, 0);
		} finally {
			this.running = undefined;
		}
	}
}
