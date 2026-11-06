import { describe, expect, it } from "vitest";
import { DataPersistence, PluginStore } from "../src/infrastructure/PluginStore";
import { normalizeTranscript } from "../src/infrastructure/transcribers/TempWorkspace";
import { TranscriptionRule } from "../src/domain/TranscriptionRule";
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
		persistence.data = { settings: { language: "en" } };
		const store = new PluginStore(persistence);
		await store.load();

		expect(store.settings).toEqual({ ...DEFAULT_SETTINGS, language: "en" });
	});

	it("M1 drops the 0.5.0 selection settings and starts with no rules, keeping everything else", async () => {
		const persistence = new MemoryPersistence();
		const deletion = { audioPath: "a.m4a", notePath: "n.md", transcript: "t" };
		persistence.data = {
			settings: {
				transcribeTagged: true,
				folder: "Journal/Daily notes",
				tags: ["transcribe"],
				removeTagsAfter: true,
				transcribeDailyNotes: true,
				dailyNotesFrom: "2026-10-01",
				engine: "openai-whisper",
				whisperPath: "/bin/whisper",
				ffmpegPath: "/bin/ffmpeg",
				model: "m.pt",
				vadModel: "v.bin",
				language: "en",
			},
			pendingDeletions: [deletion],
			speeds: { "openai-whisper:m.pt": 0.3 },
		};
		const store = new PluginStore(persistence);
		await store.load();

		expect(store.settings).toEqual({
			rules: [],
			engine: "openai-whisper",
			whisperPath: "/bin/whisper",
			ffmpegPath: "/bin/ffmpeg",
			model: "m.pt",
			vadModel: "v.bin",
			language: "en",
		});
		expect(store.list()).toEqual([deletion]);
		expect(store.speedFor("openai-whisper:m.pt")).toBe(0.3);

		await store.updateSettings({ language: "ru" });
		const saved = (persistence.data as { settings: Record<string, unknown> }).settings;
		for (const key of ["transcribeTagged", "folder", "tags", "removeTagsAfter", "transcribeDailyNotes", "dailyNotesFrom"]) {
			expect(saved).not.toHaveProperty(key);
		}
	});

	it("M2 starts a fresh install with no rules", async () => {
		const store = new PluginStore(new MemoryPersistence());
		await store.load();

		expect(store.settings.rules).toEqual([]);
	});

	it("M3 keeps saved rules across restarts", async () => {
		const persistence = new MemoryPersistence();
		const rules: TranscriptionRule[] = [
			{ scope: "daily", folders: [], fromDate: "2026-11-01", onlyTagged: true, tags: ["transcribe"], removeTagsAfter: true },
			{ scope: "folders", folders: ["/", "Inbox"], fromDate: "", onlyTagged: false, tags: [], removeTagsAfter: false },
		];
		const before = new PluginStore(persistence);
		await before.load();
		await before.updateSettings({ rules });

		const after = new PluginStore(persistence);
		await after.load();

		expect(after.settings.rules).toEqual(rules);
	});

	it("M6 a stored rule list of the wrong shape becomes no rules; odd rules stay for validation to refuse", async () => {
		for (const rules of ["x", null, 5, { scope: "folders" }]) {
			const persistence = new MemoryPersistence();
			persistence.data = { settings: { rules } };
			const store = new PluginStore(persistence);
			await store.load();
			expect(store.settings.rules).toEqual([]);
		}
		const persistence = new MemoryPersistence();
		persistence.data = { settings: { rules: [{ scope: "vault" }] } };
		const store = new PluginStore(persistence);
		await store.load();
		expect(store.settings.rules).toEqual([{ scope: "vault" }]);
	});

	it("M5 does not share the default rule list between stores", async () => {
		const one = new PluginStore(new MemoryPersistence());
		await one.load();
		one.settings.rules.push({ scope: "folders", folders: ["/"], fromDate: "", onlyTagged: false, tags: [], removeTagsAfter: false });

		const two = new PluginStore(new MemoryPersistence());
		await two.load();

		expect(two.settings.rules).toEqual([]);
		expect(DEFAULT_SETTINGS.rules).toEqual([]);
	});
});

describe("normalizeTranscript", () => {
	it("joins whisper segment lines into one paragraph", () => {
		expect(normalizeTranscript(" Привет.\n\n  Как дела?\n")).toBe("Привет. Как дела?");
	});
});
