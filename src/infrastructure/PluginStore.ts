import { DeletionJournal, PendingDeletion } from "../domain/ports";
import { DEFAULT_SETTINGS, TranscriberSettings } from "../settings";

interface PersistedData {
	settings: TranscriberSettings;
	pendingDeletions: PendingDeletion[];
}

export interface DataPersistence {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export class PluginStore implements DeletionJournal {
	private data: PersistedData = { settings: { ...DEFAULT_SETTINGS }, pendingDeletions: [] };

	constructor(private readonly persistence: DataPersistence) {}

	async load(): Promise<void> {
		const raw = ((await this.persistence.loadData()) ?? {}) as Partial<PersistedData>;
		this.data = {
			settings: { ...DEFAULT_SETTINGS, ...raw.settings },
			pendingDeletions: raw.pendingDeletions ?? [],
		};
	}

	get settings(): TranscriberSettings {
		return this.data.settings;
	}

	async updateSettings(patch: Partial<TranscriberSettings>): Promise<void> {
		this.data.settings = { ...this.data.settings, ...patch };
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
