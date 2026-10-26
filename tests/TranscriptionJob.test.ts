import { beforeEach, describe, expect, it } from "vitest";
import { JobOptions, TagRule, TranscriptionJob } from "../src/domain/TranscriptionJob";
import { FakeTranscriber, FakeVault, FixedDurations, MemoryJournal, RecordingProgress } from "./fakes";

const TAGGED: TagRule = { folders: ["Inbox"], tags: ["transcribe"], removeTagsAfter: false };

describe("TranscriptionJob", () => {
	let vault: FakeVault;
	let transcriber: FakeTranscriber;
	let journal: MemoryJournal;
	let progress: RecordingProgress;
	let durations: FixedDurations;

	const runWith = (options: JobOptions, signal = new AbortController().signal) =>
		new TranscriptionJob(vault, transcriber, durations, journal, progress).run(options, signal);
	const run = (tagged: Partial<TagRule> = {}, signal = new AbortController().signal) =>
		runWith({ tagged: { ...TAGGED, ...tagged } }, signal);

	beforeEach(() => {
		vault = new FakeVault();
		transcriber = new FakeTranscriber();
		journal = new MemoryJournal();
		progress = new RecordingProgress();
		durations = new FixedDurations();
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

		it("probes each audio duration once, repeated references count as zero", async () => {
			durations = new FixedDurations({ "/vault/att/a.webm": 30 });
			vault
				.addAudio("att/a.webm")
				.addAudio("att/b.webm")
				.addNote("Inbox/n.md", "[[a.webm]] #transcribe\n![[a.webm]] #transcribe\n![[b.webm]] #transcribe");

			await run();

			expect(progress.started.map((t) => t.durationSeconds)).toEqual([30, 0, undefined]);
		});

		it("refuses to run without tags or folders", async () => {
			vault.addAudio("att/a.webm").addNote("Inbox/n.md", "![[a.webm]] #transcribe");

			await expect(run({ tags: [] })).rejects.toThrow("tag");
			await expect(run({ folders: [] })).rejects.toThrow("folder");
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
			expect(progress.events).toEqual(["start 1", "task 1", "progress 1 0.5", "end 1"]);
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

			expect(report.failures[0].message).toContain("changed during transcription");
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

			expect(report.failures[0].message).toContain("not found");
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

	describe("split recordings", () => {
		const SPLIT = "- 21:37 ![[rec (1).m4a]] ![[rec (2).m4a]] ![[rec (3).m4a]] #transcribe";

		beforeEach(() => {
			vault.addAudio("att/rec (1).m4a").addAudio("att/rec (2).m4a").addAudio("att/rec (3).m4a");
		});

		it("joins the transcripts of side-by-side parts into one paragraph", async () => {
			vault.addNote("Inbox/n.md", SPLIT);

			const report = await run({ removeTagsAfter: true });

			expect(report).toMatchObject({ total: 1, done: 1 });
			expect(vault.content("Inbox/n.md")).toBe("- 21:37 text of rec (1) text of rec (2) text of rec (3)");
			expect(transcriber.calls).toEqual(["/vault/att/rec (1).m4a", "/vault/att/rec (2).m4a", "/vault/att/rec (3).m4a"]);
			expect(vault.trashed).toEqual(["att/rec (1).m4a", "att/rec (2).m4a", "att/rec (3).m4a"]);
			expect(journal.list()).toEqual([]);
		});

		it("transcribes references separated by other text as separate recordings", async () => {
			vault.addNote("Inbox/n.md", "![[rec (1).m4a]] and ![[rec (2).m4a]] #transcribe");

			const report = await run();

			expect(report.total).toBe(2);
			expect(vault.content("Inbox/n.md")).toBe("text of rec (1) and text of rec (2) #transcribe");
		});

		it("sums the durations of the parts", async () => {
			durations = new FixedDurations({ "/vault/att/rec (1).m4a": 270, "/vault/att/rec (2).m4a": 270, "/vault/att/rec (3).m4a": 60 });
			vault.addNote("Inbox/n.md", SPLIT);

			await run();

			expect(progress.started.map((t) => t.durationSeconds)).toEqual([600]);
		});

		it("reports progress across all parts", async () => {
			vault.addNote("Inbox/n.md", "![[rec (1).m4a]] ![[rec (2).m4a]] #transcribe");

			await run();

			expect(progress.events.filter((e) => e.startsWith("progress"))).toEqual(["progress 1 0.25", "progress 1 0.75"]);
		});

		it("skips a silent part", async () => {
			transcriber = new FakeTranscriber({ "/vault/att/rec (2).m4a": "  " });
			vault.addNote("Inbox/n.md", SPLIT);

			await run();

			expect(vault.content("Inbox/n.md")).toBe("- 21:37 text of rec (1) text of rec (3) #transcribe");
		});

		it("keeps the note and every part when one part fails", async () => {
			transcriber.failFor("/vault/att/rec (2).m4a");
			vault.addNote("Inbox/n.md", SPLIT);

			const report = await run();

			expect(report.failures).toHaveLength(1);
			expect(vault.content("Inbox/n.md")).toBe(SPLIT);
			expect(vault.trashed).toEqual([]);
		});

		it("trashes every part left after a crash between saving text and trashing", async () => {
			vault.addNote("Inbox/n.md", SPLIT);
			vault.failOnTrash = true;
			await run();
			expect(vault.content("Inbox/n.md")).toBe("- 21:37 text of rec (1) text of rec (2) text of rec (3) #transcribe");

			vault.failOnTrash = false;
			const report = await run();

			expect(report.recoveredDeletions).toBe(3);
			expect(vault.trashed).toEqual(["att/rec (1).m4a", "att/rec (2).m4a", "att/rec (3).m4a"]);
			expect(journal.list()).toEqual([]);
		});
	});

	describe("daily notes from a date", () => {
		const DAILY = "Journal/Daily notes";

		it("transcribes every audio in daily notes on or after the date, no tag needed", async () => {
			vault
				.addAudio("att/new.m4a")
				.addAudio("att/same.m4a")
				.addAudio("att/old.m4a")
				.addNote(`${DAILY}/2026-10-26.md`, "- 19:23 ![[new.m4a]]")
				.addNote(`${DAILY}/2026-10-01.md`, "![[same.m4a]]")
				.addNote(`${DAILY}/2026-07-18.md`, "![[old.m4a]]");

			const report = await runWith({ dailyNotesFrom: "2026-10-01" });

			expect(report).toMatchObject({ total: 2, done: 2 });
			expect(vault.content(`${DAILY}/2026-10-26.md`)).toBe("- 19:23 text of new");
			expect(vault.content(`${DAILY}/2026-10-01.md`)).toBe("text of same");
			expect(vault.content(`${DAILY}/2026-07-18.md`)).toBe("![[old.m4a]]");
			expect(vault.audio.has("att/old.m4a")).toBe(true);
		});

		it("ignores untagged audio outside daily notes", async () => {
			vault.addAudio("att/a.m4a").addNote("Inbox/2026-10-26.md", "![[a.m4a]]");

			expect((await runWith({ dailyNotesFrom: "2026-01-01" })).total).toBe(0);
		});

		it("processes a note matched by both rules once, every line of it, and removes the tag", async () => {
			vault.addAudio("att/a.m4a").addNote(`${DAILY}/2026-10-26.md`, "- ![[a.m4a]] #transcribe\n- ![[a.m4a]]");

			const report = await runWith({
				tagged: { folders: [DAILY], tags: ["transcribe"], removeTagsAfter: true },
				dailyNotesFrom: "2026-10-01",
			});

			expect(report).toMatchObject({ total: 1, done: 1 });
			expect(transcriber.calls).toHaveLength(1);
			expect(vault.content(`${DAILY}/2026-10-26.md`)).toBe("- text of a\n- text of a");
		});

		it("rejects a date that is not YYYY-MM-DD", async () => {
			await expect(runWith({ dailyNotesFrom: "" })).rejects.toThrow("date");
			await expect(runWith({ dailyNotesFrom: "26.10.2026" })).rejects.toThrow("date");
		});

		it("requires at least one rule", async () => {
			await expect(runWith({})).rejects.toThrow("By tag");
		});
	});
});
