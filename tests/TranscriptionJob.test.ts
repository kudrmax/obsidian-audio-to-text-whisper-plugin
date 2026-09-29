import { beforeEach, describe, expect, it } from "vitest";
import { JobOptions, TranscriptionJob } from "../src/domain/TranscriptionJob";
import { FakeTranscriber, FakeVault, MemoryJournal, RecordingProgress } from "./fakes";

const OPTIONS: JobOptions = { folders: ["Inbox"], tags: ["transcribe"], removeTagsAfter: false };

describe("TranscriptionJob", () => {
	let vault: FakeVault;
	let transcriber: FakeTranscriber;
	let journal: MemoryJournal;
	let progress: RecordingProgress;

	const run = (options: Partial<JobOptions> = {}, signal = new AbortController().signal) =>
		new TranscriptionJob(vault, transcriber, journal, progress).run({ ...OPTIONS, ...options }, signal);

	beforeEach(() => {
		vault = new FakeVault();
		transcriber = new FakeTranscriber();
		journal = new MemoryJournal();
		progress = new RecordingProgress();
	});

	describe("selection", () => {
		it("processes only audio with the tag on the same line", async () => {
			vault
				.addAudio("att/a.webm")
				.addAudio("att/old.webm")
				.addNote("Inbox/n.md", "- ![[old.webm]]\n- ![[a.webm]] #transcribe");

			const report = await run();

			expect(report.total).toBe(1);
			expect(vault.content("Inbox/n.md")).toBe("- ![[old.webm]]\n- text of a #transcribe");
			expect(vault.audio.has("att/old.webm")).toBe(true);
		});

		it("ignores tagged audio outside configured folders", async () => {
			vault.addAudio("att/a.webm").addNote("Elsewhere/n.md", "![[a.webm]] #transcribe");

			expect((await run()).total).toBe(0);
		});

		it("accepts any of the configured tags", async () => {
			vault
				.addAudio("att/a.webm")
				.addAudio("att/b.webm")
				.addAudio("att/c.webm")
				.addNote("Inbox/n.md", "![[a.webm]] #voice\n![[b.webm]] #transcribe\n![[c.webm]] #other");

			const report = await run({ tags: ["voice", "transcribe"] });

			expect(report.total).toBe(2);
			expect(vault.content("Inbox/n.md")).toContain("![[c.webm]] #other");
		});

		it("handles embeds and plain links to the same audio independently of each other", async () => {
			vault
				.addAudio("All files/rec.m4a")
				.addNote("Inbox/n.md", "- [[All files/rec.m4a]] #transcribe\n- ![[All files/rec.m4a]] #transcribe");

			const report = await run();

			expect(report).toMatchObject({ total: 2, done: 2 });
			expect(vault.content("Inbox/n.md")).toBe("- text of rec #transcribe\n- text of rec #transcribe");
			expect(transcriber.calls).toHaveLength(1);
			expect(vault.trashed).toEqual(["All files/rec.m4a"]);
		});

		it("refuses to run without tags or folders", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");

			await expect(run({ tags: [] })).rejects.toThrow("тег");
			await expect(run({ folders: [] })).rejects.toThrow("папки");
			expect(transcriber.calls).toEqual([]);
		});
	});

	describe("replacement", () => {
		it("replaces the audio with its transcript and trashes the audio", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "before\n![[a.webm]] #transcribe\nafter");

			const report = await run();

			expect(vault.content("Inbox/n.md")).toBe("before\ntext of a #transcribe\nafter");
			expect(vault.trashed).toEqual(["att/a.webm"]);
			expect(journal.list()).toEqual([]);
			expect(report).toMatchObject({ total: 1, done: 1, failures: [], cancelled: false });
			expect(progress.events).toEqual(["start 1", "task 1/1", "end 1/1"]);
		});

		it("removes the tag from the transcribed line only", async () => {
			vault
				.addAudio("att/a.webm")
				.addAudio("att/b.webm")
				.addNote("Inbox/n.md", "- ![[a.webm]] #transcribe\n- idea #transcribe\n- ![[b.webm]] #transcribe");
			transcriber.failFor("/vault/att/b.webm");

			await run({ removeTagsAfter: true });

			expect(vault.content("Inbox/n.md")).toBe("- text of a\n- idea #transcribe\n- ![[b.webm]] #transcribe");
		});

		it("leaves an untagged reference to the same audio intact and keeps the audio", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe\nsee ![[a.webm]]");

			await run();

			expect(vault.content("Inbox/n.md")).toBe("text of a #transcribe\nsee ![[a.webm]]");
			expect(vault.trashed).toEqual([]);
		});

		it("does not trash audio still referenced by another note", async () => {
			vault
				.addAudio("att/a.webm")
				.addNote("Inbox/n.md", "![[a.webm]] #transcribe")
				.addNote("Other/ref.md", "see [[a.webm]]");

			await run();

			expect(vault.content("Inbox/n.md")).toBe("text of a #transcribe");
			expect(vault.trashed).toEqual([]);
			expect(journal.list()).toEqual([]);
		});

		it("transcribes audio shared by two notes once and trashes it after the last one", async () => {
			vault
				.addAudio("att/a.webm")
				.addNote("Inbox/one.md", "![[a.webm]] #transcribe")
				.addNote("Inbox/two.md", "x ![[a.webm]] #transcribe");

			await run({ removeTagsAfter: true });

			expect(transcriber.calls).toEqual(["/vault/att/a.webm"]);
			expect(vault.content("Inbox/one.md")).toBe("text of a");
			expect(vault.content("Inbox/two.md")).toBe("x text of a");
			expect(vault.trashed).toEqual(["att/a.webm"]);
		});

		it("is idempotent: a second run has nothing to do", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");

			await run();
			const second = await run();

			expect(second.total).toBe(0);
			expect(transcriber.calls).toHaveLength(1);
		});
	});

	describe("failures", () => {
		it("keeps note and audio untouched when whisper fails", async () => {
			transcriber.failFor("/vault/att/a.webm");
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");

			const report = await run();

			expect(vault.content("Inbox/n.md")).toBe("![[a.webm]] #transcribe");
			expect(vault.audio.has("att/a.webm")).toBe(true);
			expect(report.failures).toHaveLength(1);
			expect(journal.list()).toEqual([]);
		});

		it("keeps audio when transcript is empty", async () => {
			transcriber = new FakeTranscriber({ "/vault/att/a.webm": "  \n " });
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");

			const report = await run();

			expect(vault.content("Inbox/n.md")).toBe("![[a.webm]] #transcribe");
			expect(report.failures).toHaveLength(1);
		});

		it("keeps audio when the tagged line was edited during transcription", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe\nother");
			vault.editDuringTranscription = (content) => content.replace(" #transcribe", "");

			const report = await run();

			expect(report.failures[0].message).toContain("изменили во время распознавания");
			expect(vault.content("Inbox/n.md")).toBe("![[a.webm]]\nother");
			expect(vault.audio.has("att/a.webm")).toBe(true);
			expect(journal.list()).toEqual([]);
		});

		it("keeps edits made elsewhere in the note during transcription", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe\nother");
			vault.editDuringTranscription = (content) => content.replace("other", "edited");

			await run();

			expect(vault.content("Inbox/n.md")).toBe("text of a #transcribe\nedited");
		});

		it("reports a missing audio file", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");
			const embeds = vault.findAudioEmbeds("Inbox/n.md");
			vault.audio.clear();
			vault.findAudioEmbeds = () => embeds;

			const report = await run();

			expect(report.failures[0].message).toContain("не найден");
			expect(vault.content("Inbox/n.md")).toBe("![[a.webm]] #transcribe");
		});

		it("stops on cancellation without touching remaining audio", async () => {
			vault
				.addAudio("att/a.webm")
				.addAudio("att/b.webm")
				.addNote("Inbox/n.md", "![[a.webm]] #transcribe\n![[b.webm]] #transcribe");
			const controller = new AbortController();
			progress.onTaskEnd = () => controller.abort();

			const report = await run({}, controller.signal);

			expect(report).toMatchObject({ total: 2, done: 1, cancelled: true });
			expect(vault.content("Inbox/n.md")).toBe("text of a #transcribe\n![[b.webm]] #transcribe");
			expect(vault.audio.has("att/b.webm")).toBe(true);
		});
	});

	describe("crash recovery", () => {
		it("trashes audio left after a crash between saving text and trashing", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");
			vault.failOnTrash = true;
			await run();
			expect(vault.content("Inbox/n.md")).toBe("text of a #transcribe");
			expect(vault.audio.has("att/a.webm")).toBe(true);

			vault.failOnTrash = false;
			const report = await run();

			expect(report.recoveredDeletions).toBe(1);
			expect(vault.trashed).toEqual(["att/a.webm"]);
			expect(journal.list()).toEqual([]);
		});

		it("never trashes audio whose text was not saved", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");
			vault.failOnEdit = true;
			await run();
			expect(journal.list()).toHaveLength(1);

			vault.failOnEdit = false;
			vault.notes.get("Inbox/n.md")!.content = "user removed the link";
			const report = await run();

			expect(report.recoveredDeletions).toBe(0);
			expect(vault.audio.has("att/a.webm")).toBe(true);
			expect(journal.list()).toEqual([]);
		});

		it("reprocesses audio after a crash before saving text", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");
			vault.failOnEdit = true;
			await run();

			vault.failOnEdit = false;
			const report = await run();

			expect(report.done).toBe(1);
			expect(vault.content("Inbox/n.md")).toBe("text of a #transcribe");
			expect(vault.trashed).toEqual(["att/a.webm"]);
		});
	});
});
