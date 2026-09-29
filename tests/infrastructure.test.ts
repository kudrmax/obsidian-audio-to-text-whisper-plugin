import { describe, expect, it } from "vitest";
import { DataPersistence, PluginStore } from "../src/infrastructure/PluginStore";
import { normalizeTranscript } from "../src/infrastructure/transcribers/TempWorkspace";
import { DEFAULT_SETTINGS } from "../src/settings";

class MemoryPersistence implements DataPersistence {
	data: unknown = null;
	async loadData(): Promise<unknown> {
		return structuredClone(this.data);
	}
	async saveData(data: unknown): Promise<void> {
		this.data = structuredClone(data);
	}
}

describe("PluginStore", () => {
	it("persists pending deletions across plugin restarts", async () => {
		const persistence = new MemoryPersistence();
		const before = new PluginStore(persistence);
		await before.load();
		await before.add({ audioPath: "a.webm", notePath: "n.md", transcript: "t" });

		const after = new PluginStore(persistence);
		await after.load();

		expect(after.list()).toEqual([{ audioPath: "a.webm", notePath: "n.md", transcript: "t" }]);
		await after.remove("a.webm");
		expect(after.list()).toEqual([]);
	});

	it("fills missing settings with defaults", async () => {
		const persistence = new MemoryPersistence();
		persistence.data = { settings: { tags: ["voice"] } };
		const store = new PluginStore(persistence);
		await store.load();

		expect(store.settings).toEqual({ ...DEFAULT_SETTINGS, tags: ["voice"] });
	});
});

describe("normalizeTranscript", () => {
	it("joins whisper segment lines into one paragraph", () => {
		expect(normalizeTranscript(" Привет.\n\n  Как дела?\n")).toBe("Привет. Как дела?");
	});
});
