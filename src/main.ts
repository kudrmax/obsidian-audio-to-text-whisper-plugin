import { Notice, Plugin } from "obsidian";
import { JobOptions, TranscriptionJob } from "./domain/TranscriptionJob";
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
		this.addRibbonIcon("audio-lines", "Transcribe audio", () => void this.transcribe());
		this.addCommand({ id: "transcribe", name: "Transcribe audio", callback: () => void this.transcribe() });
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

	private jobOptions(): JobOptions {
		const settings = this.store.settings;
		const folder = settings.folder.trim();
		return {
			tagged: settings.transcribeTagged
				? { folders: folder ? [folder] : [], tags: settings.tags, removeTagsAfter: settings.removeTagsAfter }
				: undefined,
			dailyNotesFrom: settings.transcribeDailyNotes ? settings.dailyNotesFrom : undefined,
		};
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
			await job.run(this.jobOptions(), this.running.signal);
		} catch (error) {
			new Notice(`Audio to Text: ${error instanceof Error ? error.message : String(error)}`, 0);
		} finally {
			this.running = undefined;
		}
	}
}
