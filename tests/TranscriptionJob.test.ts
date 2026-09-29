import { beforeEach, describe, expect, it } from "vitest";
import { TranscriptionJob } from "../src/domain/TranscriptionJob";
import { FakeTranscriber, FakeVault, MemoryJournal, RecordingProgress } from "./fakes";

const OPTIONS = { folders: ["Inbox"], tags: ["transcribe"] };

describe("TranscriptionJob", () => {
	let vault: FakeVault;
	let transcriber: FakeTranscriber;
	let journal: MemoryJournal;
	let progress: RecordingProgress;

	const job = () => new TranscriptionJob(vault, transcriber, journal, progress);
	const run = (signal = new AbortController().signal) => job().run(OPTIONS, signal);

	beforeEach(() => {
		vault = new FakeVault();
		transcriber = new FakeTranscriber();
		journal = new MemoryJournal();
		progress = new RecordingProgress();
	});

	it("replaces embedded audio with transcript and trashes the audio", async () => {
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "before\n![[a.webm]]\nafter", ["transcribe"]);

		const report = await run();

		expect(vault.content("Inbox/n.md")).toBe("before\ntext of a\nafter");
		expect(vault.trashed).toEqual(["att/a.webm"]);
		expect(journal.list()).toEqual([]);
		expect(report).toMatchObject({ total: 1, done: 1, failures: [], cancelled: false });
		expect(progress.events).toEqual(["start 1", "task 1/1", "end 1/1"]);
	});

	it("ignores notes without the tag or outside configured folders", async () => {
		vault
			.addAudio("att/a.webm")
			.addNote("Inbox/untagged.md", "![[a.webm]]", ["other"])
			.addNote("Elsewhere/tagged.md", "![[a.webm]]", ["transcribe"]);

		const report = await run();

		expect(report.total).toBe(0);
		expect(vault.trashed).toEqual([]);
	});

	it("processes every note in configured folders when no tags are set", async () => {
		vault
			.addAudio("att/a.webm")
			.addAudio("att/b.webm")
			.addNote("Inbox/untagged.md", "![[a.webm]]")
			.addNote("Inbox/Sub/other.md", "![[b.webm]]", ["other"])
			.addNote("Elsewhere/n.md", "![[a.webm]]");

		const report = await job().run({ folders: ["Inbox"], tags: [] }, new AbortController().signal);

		expect(report.total).toBe(2);
		expect(vault.content("Inbox/untagged.md")).toBe("text of a");
		expect(vault.content("Inbox/Sub/other.md")).toBe("text of b");
	});

	it("matches notes having any of the configured tags", async () => {
		vault
			.addAudio("att/a.webm")
			.addAudio("att/b.webm")
			.addAudio("att/c.webm")
			.addNote("Inbox/one.md", "![[a.webm]]", ["voice"])
			.addNote("Inbox/two.md", "![[b.webm]]", ["transcribe"])
			.addNote("Inbox/three.md", "![[c.webm]]", ["other"]);

		const report = await job().run({ folders: ["Inbox"], tags: ["voice", "transcribe"] }, new AbortController().signal);

		expect(report.total).toBe(2);
		expect(vault.content("Inbox/three.md")).toBe("![[c.webm]]");
	});

	it("replaces both embeds and plain links to the same audio", async () => {
		vault
			.addAudio("All files/rec.m4a")
			.addNote("Inbox/n.md", "[[All files/rec.m4a]]\n![[All files/rec.m4a]]", ["transcribe"]);

		const report = await run();

		expect(report).toMatchObject({ total: 2, done: 2 });
		expect(vault.content("Inbox/n.md")).toBe("text of rec\ntext of rec");
		expect(transcriber.calls).toHaveLength(1);
		expect(vault.trashed).toEqual(["All files/rec.m4a"]);
	});

	it("refuses to run without folders", async () => {
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]");

		await expect(job().run({ folders: [], tags: [] }, new AbortController().signal)).rejects.toThrow("папки");
		expect(vault.content("Inbox/n.md")).toBe("![[a.webm]]");
	});

	it("keeps note and audio untouched when whisper fails", async () => {
		transcriber.failFor("/vault/att/a.webm");
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"]);

		const report = await run();

		expect(vault.content("Inbox/n.md")).toBe("![[a.webm]]");
		expect(vault.audio.has("att/a.webm")).toBe(true);
		expect(report.failures).toHaveLength(1);
		expect(journal.list()).toEqual([]);
	});

	it("keeps audio when transcript is empty", async () => {
		transcriber = new FakeTranscriber({ "/vault/att/a.webm": "  \n " });
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"]);

		const report = await run();

		expect(vault.content("Inbox/n.md")).toBe("![[a.webm]]");
		expect(vault.audio.has("att/a.webm")).toBe(true);
		expect(report.failures).toHaveLength(1);
	});

	it("does not trash audio still referenced by another note", async () => {
		vault
			.addAudio("att/a.webm")
			.addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"])
			.addNote("Other/ref.md", "see [[a.webm]]");

		await run();

		expect(vault.content("Inbox/n.md")).toBe("text of a");
		expect(vault.trashed).toEqual([]);
		expect(journal.list()).toEqual([]);
	});

	it("transcribes shared audio once and trashes it after the last note", async () => {
		vault
			.addAudio("att/a.webm")
			.addNote("Inbox/one.md", "![[a.webm]]", ["transcribe"])
			.addNote("Inbox/two.md", "x ![[a.webm]]", ["transcribe"]);

		await run();

		expect(transcriber.calls).toEqual(["/vault/att/a.webm"]);
		expect(vault.content("Inbox/one.md")).toBe("text of a");
		expect(vault.content("Inbox/two.md")).toBe("x text of a");
		expect(vault.trashed).toEqual(["att/a.webm"]);
	});

	it("is idempotent: a second run has nothing to do", async () => {
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"]);

		await run();
		const second = await run();

		expect(second.total).toBe(0);
		expect(transcriber.calls).toHaveLength(1);
		expect(vault.content("Inbox/n.md")).toBe("text of a");
	});

	it("recovers after a crash between replacing text and trashing audio", async () => {
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"]);
		vault.failOnTrash = true;
		await expect(run()).resolves.toMatchObject({ failures: [expect.anything()] });
		expect(vault.content("Inbox/n.md")).toBe("text of a");
		expect(vault.audio.has("att/a.webm")).toBe(true);

		vault.failOnTrash = false;
		const report = await run();

		expect(report.recoveredDeletions).toBe(1);
		expect(vault.trashed).toEqual(["att/a.webm"]);
		expect(journal.list()).toEqual([]);
	});

	it("never trashes audio after a crash before its text was saved", async () => {
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"]);
		vault.failOnReplace = true;
		await run();
		expect(journal.list()).toHaveLength(1);

		vault.failOnReplace = false;
		vault.notes.get("Inbox/n.md")!.content = "user removed the link";
		const report = await run();

		expect(report.recoveredDeletions).toBe(0);
		expect(vault.audio.has("att/a.webm")).toBe(true);
		expect(journal.list()).toEqual([]);
	});

	it("reprocesses audio after a crash before replacing", async () => {
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"]);
		vault.failOnReplace = true;
		await run();

		vault.failOnReplace = false;
		const report = await run();

		expect(report.done).toBe(1);
		expect(vault.content("Inbox/n.md")).toBe("text of a");
		expect(vault.trashed).toEqual(["att/a.webm"]);
	});

	it("stops on cancellation without touching remaining notes", async () => {
		vault
			.addAudio("att/a.webm")
			.addAudio("att/b.webm")
			.addNote("Inbox/n.md", "![[a.webm]] ![[b.webm]]", ["transcribe"]);
		const controller = new AbortController();
		progress.onTaskEnd = () => controller.abort();

		const report = await run(controller.signal);

		expect(report).toMatchObject({ total: 2, done: 1, cancelled: true });
		expect(vault.content("Inbox/n.md")).toBe("text of a ![[b.webm]]");
		expect(vault.audio.has("att/b.webm")).toBe(true);
	});

	it("reports missing audio file as failure", async () => {
		vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]]", ["transcribe"]);
		vault.audio.clear();
		vault.audio.add("att/a.webm");
		const embeds = vault.findAudioEmbeds("Inbox/n.md");
		vault.audio.clear();
		vault.findAudioEmbeds = () => embeds;

		const report = await run();

		expect(report.failures[0].message).toContain("не найден");
		expect(vault.content("Inbox/n.md")).toBe("![[a.webm]]");
	});
});
