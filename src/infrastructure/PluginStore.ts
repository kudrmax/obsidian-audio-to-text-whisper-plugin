import { DeletionJournal, PendingDeletion } from "../domain/ports";
import { DEFAULT_SETTINGS, TranscriberSettings } from "../settings";

interface PersistedData {
	settings: TranscriberSettings;
	pendingDeletions: PendingDeletion[];
	/** Processing seconds per second of audio, keyed by engine and model. */
	speeds: Record<string, number>;
}

export interface DataPersistence {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export class PluginStore implements DeletionJournal {
	private data: PersistedData = { settings: { ...DEFAULT_SETTINGS }, pendingDeletions: [], speeds: {} };

	constructor(private readonly persistence: DataPersistence) {}

	async load(): Promise<void> {
		const raw = ((await this.persistence.loadData()) ?? {}) as Partial<PersistedData>;
		const stored = (raw.settings ?? {}) as Partial<TranscriberSettings>;
		const settings = { ...DEFAULT_SETTINGS };
		for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof TranscriberSettings)[]) {
			if (stored[key] !== undefined) (settings as Record<string, unknown>)[key] = stored[key];
		}
		this.data = { settings, pendingDeletions: raw.pendingDeletions ?? [], speeds: raw.speeds ?? {} };
	}

	get settings(): TranscriberSettings {
		return this.data.settings;
	}

	async updateSettings(patch: Partial<TranscriberSettings>): Promise<void> {
		this.data.settings = { ...this.data.settings, ...patch };
		await this.save();
	}

	speedFor(key: string): number | undefined {
		return this.data.speeds[key];
	}

	async saveSpeed(key: string, speed: number): Promise<void> {
		this.data.speeds = { ...this.data.speeds, [key]: speed };
		await this.save();
	}

	list(): PendingDeletion[] {
		return [...this.data.pendingDeletions];
	}

	async add(entry: PendingDeletion): Promise<void> {
		this.data.pendingDeletions = [...this.data.pendingDeletions.filter((e) => e.audioPath !== entry.audioPath), entry];
		await this.save();
	}

	async remove(audioPath: string): Promise<void> {
		this.data.pendingDeletions = this.data.pendingDeletions.filter((e) => e.audioPath !== audioPath);
		await this.save();
	}

	private save(): Promise<void> {
		return this.persistence.saveData(this.data);
	}
}
