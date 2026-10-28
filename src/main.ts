import { Notice, Plugin, TFile } from "obsidian";
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
		this.addRibbonIcon("audio-lines", "Transcribe audio", () => void this.transcribe(this.rulesOptions()));
		this.addCommand({ id: "transcribe", name: "Transcribe audio", callback: () => void this.transcribe(this.rulesOptions()) });
		this.addRibbonIcon("file-audio", "Transcribe audio in current note", () => this.transcribeCurrentNote());
		this.addCommand({
			id: "transcribe-current-note",
			name: "Transcribe audio in current note",
			checkCallback: (checking) => {
				const note = this.currentNote();
				if (!note) return false;
				if (!checking) void this.transcribeNote(note);
				return true;
			},
		});
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

	private currentNote(): TFile | undefined {
		const file = this.app.workspace.getActiveFile();
		return file?.extension === "md" ? file : undefined;
	}

	private transcribeCurrentNote(): void {
		const note = this.currentNote();
		if (!note) {
			new Notice("Audio to Text: open a note to transcribe its audio");
			return;
		}
		void this.transcribeNote(note);
	}

	private transcribeNote(note: TFile): Promise<void> {
		const settings = this.store.settings;
		return this.transcribe({
			notePath: note.path,
			tagsToRemove: settings.transcribeTagged && settings.removeTagsAfter ? settings.tags : [],
		});
	}

	private rulesOptions(): JobOptions {
		const settings = this.store.settings;
		const folder = settings.folder.trim();
		return {
			tagged: settings.transcribeTagged
				? { folders: folder ? [folder] : [], tags: settings.tags, removeTagsAfter: settings.removeTagsAfter }
				: undefined,
			dailyNotesFrom: settings.transcribeDailyNotes ? settings.dailyNotesFrom : undefined,
		};
	}

	private async transcribe(options: JobOptions): Promise<void> {
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
			await job.run(options, this.running.signal);
		} catch (error) {
			new Notice(`Audio to Text: ${error instanceof Error ? error.message : String(error)}`, 0);
		} finally {
			this.running = undefined;
		}
	}
}
