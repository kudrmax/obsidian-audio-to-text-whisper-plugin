import { Notice, Plugin } from "obsidian";
import { TranscriptionJob } from "./domain/TranscriptionJob";
import { FfprobeAudioDurations } from "./infrastructure/FfprobeAudioDurations";
import { ObsidianVaultGateway } from "./infrastructure/ObsidianVaultGateway";
import { PluginStore } from "./infrastructure/PluginStore";
import { TranscriberFactory } from "./infrastructure/transcribers/TranscriberFactory";
import { ProgressNotice } from "./ui/ProgressNotice";
import { SettingsTab } from "./ui/SettingsTab";

export default class AudioToTextPlugin extends Plugin {
	private readonly store = new PluginStore(this);
	private running?: AbortController;
	private statusBar!: HTMLElement;

	override async onload(): Promise<void> {
		await this.store.load();
		this.statusBar = this.addStatusBarItem();
		this.addSettingTab(new SettingsTab(this.app, this, this.store));
		this.addRibbonIcon("mic", "Transcribe tagged audio", () => void this.transcribe());
		this.addCommand({ id: "transcribe", name: "Transcribe tagged audio", callback: () => void this.transcribe() });
		this.addCommand({
			id: "cancel",
			name: "Stop transcription",
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
			new Notice("Audio to Text: transcription is already running");
			return;
		}
		const settings = this.store.settings;
		const speedKey = `${settings.engine}:${settings.model}`;

		this.running = new AbortController();
		try {
			const job = new TranscriptionJob(
				new ObsidianVaultGateway(this.app),
				TranscriberFactory.create(settings),
				new FfprobeAudioDurations(settings.ffmpegPath),
				this.store,
				new ProgressNotice(this.statusBar, this.store.speedFor(speedKey), (speed) => void this.store.saveSpeed(speedKey, speed)),
			);
			const folders = settings.folder.trim() ? [settings.folder.trim()] : [];
			await job.run({ folders, tags: settings.tags, removeTagsAfter: settings.removeTagsAfter }, this.running.signal);
		} catch (error) {
			new Notice(`Audio to Text: ${error instanceof Error ? error.message : String(error)}`, 0);
		} finally {
			this.running = undefined;
		}
	}
}
