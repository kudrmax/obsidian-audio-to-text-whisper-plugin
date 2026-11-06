import { beforeEach, describe, expect, it } from "vitest";
import { TranscriptionJob } from "../src/domain/TranscriptionJob";
import { TranscriptionRule } from "../src/domain/TranscriptionRule";
import { FakeTranscriber, FakeVault, FixedDurations, MemoryJournal, RecordingProgress } from "./fakes";

const DAILY = "Journal/Daily notes";

const FIXTURE: Record<string, string> = {
	"Inbox/n.md": "![[in-t.m4a]] #transcribe\n![[in-u.m4a]]\n![[in-v.m4a]] #voice",
	"Inbox/Sub/deep.md": "![[deep-t.m4a]] #transcribe\n![[deep-u.m4a]]",
	"Inbox2/n.md": "![[in2-t.m4a]] #transcribe\n![[in2-u.m4a]]",
	"Projects/Voice/m.md": "![[pv-t.m4a]] #transcribe\n![[pv-u.m4a]]",
	"Other/o.md": "![[o-t.m4a]] #transcribe\n![[o-u.m4a]]\n![[o-v.m4a]] #voice",
	"root.md": "![[root-t.m4a]] #transcribe\n![[root-u.m4a]]",
	[`${DAILY}/2026-10-31.md`]: "![[d31-t.m4a]] #transcribe\n![[d31-u.m4a]]",
	[`${DAILY}/2026-11-01.md`]: "![[d01-t.m4a]] #transcribe\n![[d01-u.m4a]]",
	[`${DAILY}/2026-11-02.md`]: "![[d02-t.m4a]] #transcribe\n![[d02-u.m4a]]",
	[`${DAILY}/Archive/2026-11-05.md`]: "![[arch-t.m4a]] #transcribe\n![[arch-u.m4a]]",
	[`${DAILY}/Ideas.md`]: "![[ideas-t.m4a]] #transcribe\n![[ideas-u.m4a]]",
};

const ALL_AUDIO = Object.values(FIXTURE).flatMap((content) => [...content.matchAll(/\[\[([^\]]+)\.m4a\]\]/g)].map((m) => m[1]));

function folders(paths: string[], tags?: string[], removeTagsAfter = false): TranscriptionRule {
	return { scope: "folders", folders: paths, fromDate: "", onlyTagged: tags !== undefined, tags: tags ?? [], removeTagsAfter };
}

function daily(fromDate = "", tags?: string[], removeTagsAfter = false): TranscriptionRule {
	return { scope: "daily", folders: [], fromDate, onlyTagged: tags !== undefined, tags: tags ?? [], removeTagsAfter };
}

describe("Transcription rules", () => {
	let vault: FakeVault;
	let transcriber: FakeTranscriber;
	let original: Map<string, string>;
	let journal: MemoryJournal;

	const run = (rules: unknown[]) =>
		new TranscriptionJob(vault, transcriber, new FixedDurations(), journal, new RecordingProgress()).run(
			{ rules: rules as TranscriptionRule[] },
			new AbortController().signal,
		);

	const transcribed = () => transcriber.calls.map((path) => path.split("/").pop()!.replace(".m4a", "")).sort();

	/** Exactly these audio are transcribed and trashed; every note equals its original with just their references replaced. */
	const expectOnly = (names: string[]) => {
		expect(transcribed()).toEqual([...names].sort());
		expect(vault.trashed.map((p) => p.split("/").pop()!.replace(".m4a", "")).sort()).toEqual([...names].sort());
		for (const [path, content] of original) {
			const expected = content.replace(/!?\[\[([^\]|]+)\.m4a(?:\|[^\]]*)?\]\]/g, (reference, name: string) =>
				names.includes(name) ? `text of ${name}` : reference,
			);
			expect(vault.content(path), path).toBe(expected);
		}
	};

	const expectRefused = async (rules: unknown[], message?: string) => {
		const result = run(rules);
		await (message ? expect(result).rejects.toThrow(message) : expect(result).rejects.toThrow());
		expect(transcriber.calls).toEqual([]);
		expect(vault.trashed).toEqual([]);
		for (const [path, content] of original) expect(vault.content(path)).toBe(content);
	};

	const addNote = (path: string, content: string) => {
		vault.addNote(path, content);
		for (const [, name] of content.matchAll(/\[\[([^\]|]+\.m4a)/g)) vault.addAudio(`att/${name}`);
		original.set(path, content);
	};

	beforeEach(() => {
		vault = new FakeVault();
		transcriber = new FakeTranscriber();
		original = new Map();
		journal = new MemoryJournal();
		for (const [path, content] of Object.entries(FIXTURE)) addNote(path, content);
	});

	describe("validation refuses the whole run", () => {
		it("V1 without rules", async () => {
			await expectRefused([], "rule");
		});

		it("V2 folders rule with no folders", async () => {
			await expectRefused([folders([])], "folder");
		});

		it("V3 folders rule with only blank folders", async () => {
			await expectRefused([folders(["", "  "])], "folder");
		});

		it("V4 tagged rule with no tags", async () => {
			await expectRefused([folders(["Inbox"], [])], "tag");
		});

		it("V5 tagged rule with only blank tags", async () => {
			await expectRefused([folders(["Inbox"], ["", " ", "#"])], "tag");
		});

		it("V6 impossible date", async () => {
			await expectRefused([daily("2026-13-45")], "date");
			await expectRefused([daily("2026-02-30")], "date");
		});

		it("V7 date in another format", async () => {
			await expectRefused([daily("01.11.2026")], "date");
			await expectRefused([daily("2026-2-1")], "date");
			await expectRefused([daily(" 2026-11-01 ")], "date");
		});

		it("V8 daily rule while daily notes are not set up", async () => {
			vault.dailyNotesEnabled = false;
			await expectRefused([daily()], "Daily notes");
		});

		it("V9 one invalid rule among valid ones", async () => {
			await expectRefused([folders(["/"]), folders(["Inbox"], [])], "tag");
		});

		it("V11 a tag that cannot be a tag", async () => {
			await expectRefused([folders(["/"], ["my tag"])], "tag");
			await expectRefused([folders(["/"], ["a,b"])], "tag");
			await expectRefused([folders(["/"], ["2026"])], "tag");
		});

		it("V12 validation happens before pending deletions are finished", async () => {
			addNote("Other/done.md", "text of done");
			vault.addAudio("att/done.m4a");
			await journal.add({ audioPath: "att/done.m4a", notePath: "Other/done.md", transcript: "text of done" });
			await expectRefused([folders(["Inbox"], [])], "tag");
			expect(journal.list()).toHaveLength(1);
			expect(vault.audio.has("att/done.m4a")).toBe(true);
		});

		it("V13 validation happens before any note is read", async () => {
			vault.dailyNotesEnabled = false;
			let reads = 0;
			const read = vault.readNote.bind(vault);
			vault.readNote = (path) => (reads++, read(path));
			await expectRefused([folders(["/"]), daily()], "Daily notes");
			expect(reads).toBe(0);
		});

		it("V10 malformed stored rules", async () => {
			const valid = folders(["Inbox"], ["transcribe"]);
			await expectRefused([{ ...valid, onlyTagged: undefined }]);
			await expectRefused([{ ...valid, onlyTagged: "yes" }]);
			await expectRefused([{ ...valid, scope: "vault" }]);
			await expectRefused([{ ...valid, folders: "Inbox" }]);
			await expectRefused([{ ...valid, tags: "transcribe" }]);
			await expectRefused([{ ...valid, removeTagsAfter: undefined }]);
			await expectRefused([{ ...daily(), fromDate: undefined }]);
			await expectRefused([{ ...valid, folders: [1] }]);
			await expectRefused([{ ...valid, tags: [null] }]);
			await expectRefused([null]);
			await expectRefused(["Inbox"]);
		});
	});

	describe("folder scope", () => {
		it("F1 one folder, every audio, subfolders included", async () => {
			await run([folders(["Inbox"])]);
			expectOnly(["in-t", "in-u", "in-v", "deep-t", "deep-u"]);
		});

		it("F2 several folders", async () => {
			await run([folders(["Inbox", "Projects/Voice"])]);
			expectOnly(["in-t", "in-u", "in-v", "deep-t", "deep-u", "pv-t", "pv-u"]);
		});

		it("F3 / is the whole vault", async () => {
			await run([folders(["/"])]);
			expectOnly(ALL_AUDIO);
		});

		it("F4 one folder, tagged", async () => {
			await run([folders(["Inbox"], ["transcribe"])]);
			expectOnly(["in-t", "deep-t"]);
		});

		it("F5 whole vault, tagged", async () => {
			await run([folders(["/"], ["transcribe"])]);
			expectOnly(ALL_AUDIO.filter((name) => name.endsWith("-t")));
		});

		it("F6 folder with spaces and a trailing slash", async () => {
			await run([folders([" Inbox/ "])]);
			expectOnly(["in-t", "in-u", "in-v", "deep-t", "deep-u"]);
		});

		it("F6b leading slash, doubled slash and a blank row next to a real folder", async () => {
			await run([folders(["/Inbox/", "", "  "])]);
			expectOnly(["in-t", "in-u", "in-v", "deep-t", "deep-u"]);
		});

		it("F6c Inbox//Sub is Inbox/Sub", async () => {
			await run([folders(["Inbox//Sub"])]);
			expectOnly(["deep-t", "deep-u"]);
		});

		it("F6d a slash with spaces is the whole vault", async () => {
			await run([folders([" / "])]);
			expectOnly(ALL_AUDIO);
		});

		it("F6e cyrillic folder names match whatever their unicode form", async () => {
			addNote("Входящие/Идеи/й.md".normalize("NFD"), "![[cyr.m4a]]");
			await run([folders(["Входящие/Идеи".normalize("NFC")])]);
			expectOnly(["cyr"]);
		});

		it("F7 a folder never matches a sibling with the same prefix", async () => {
			await run([folders(["Inbox"])]);
			expect(transcribed().some((name) => name.startsWith("in2"))).toBe(false);
		});

		it("F8 a missing folder matches nothing", async () => {
			const report = await run([folders(["Nope"])]);
			expect(report.total).toBe(0);
			expectOnly([]);
		});

		it("F9 a frontmatter tag never selects a line", async () => {
			addNote("Inbox/fm.md", "---\ntags: [transcribe]\n---\n![[fm.m4a]]");
			await run([folders(["/"], ["transcribe"])]);
			expect(transcribed()).not.toContain("fm");
			expect(vault.content("Inbox/fm.md")).toBe(original.get("Inbox/fm.md"));
		});

		it("F10 longer and nested tags do not match, case does not matter", async () => {
			addNote("Other/x.md", "![[x1.m4a]] #transcribe-later\n![[x2.m4a]] #transcribe/sub\n![[x3.m4a]] #Transcribe");
			await run([folders(["Other"], ["transcribe"])]);
			expectOnly(["o-t", "x3"]);
		});

		it("F11 a tag on another line does not select the audio", async () => {
			addNote("Other/y.md", "#transcribe\n![[y.m4a]]");
			await run([folders(["Other"], ["transcribe"])]);
			expectOnly(["o-t"]);
		});

		it("F14 tags in inline code, comments, code blocks and frontmatter never select a line", async () => {
			const content = [
				"---",
				'audio: "[[fmprop.m4a]]"',
				"tags: [transcribe]",
				"---",
				"![[c1.m4a]] `#transcribe`",
				"![[c2.m4a]] %% #transcribe %%",
				"![[c3.m4a]] <!-- #transcribe -->",
				"```",
				"![[c4.m4a]] #transcribe",
				"```",
				"![[c5.m4a]] #transcribe",
			].join("\n");
			addNote("Other/code.md", content);
			await run([folders(["Other"], ["transcribe"])]);
			expectOnly(["o-t", "c5"]);
			expect(vault.content("Other/code.md")).toBe(content.replace("![[c5.m4a]]", "text of c5"));
		});

		it("F15 every-audio rules never touch frontmatter or code blocks", async () => {
			const content = ['---', 'audio: "[[fm2.m4a]]"', "---", "```", "![[code.m4a]]", "```", "~~~", "![[code2.m4a]]", "~~~", "![[body.m4a]]"].join("\n");
			addNote("Other/fm2.md", content);
			await run([folders(["Other"])]);
			expect(vault.content("Other/fm2.md")).toBe(content.replace("![[body.m4a]]", "text of body"));
			expectOnly(["o-t", "o-u", "o-v", "body"]);
		});

		it("F12 a folder name is case-sensitive", async () => {
			await run([folders(["inbox"])]);
			expectOnly([]);
		});

		it("F13 a folder given as a note path's prefix without the slash matches no file", async () => {
			addNote("Inbox.md", "![[inboxnote.m4a]]");
			await run([folders(["Inbox"])]);
			expect(transcribed()).not.toContain("inboxnote");
		});
	});

	describe("daily scope", () => {
		it("D1 every daily note, every audio", async () => {
			await run([daily()]);
			expectOnly(["d31-t", "d31-u", "d01-t", "d01-u", "d02-t", "d02-u"]);
		});

		it("D2 from a date, the date itself included", async () => {
			await run([daily("2026-11-01")]);
			expectOnly(["d01-t", "d01-u", "d02-t", "d02-u"]);
		});

		it("D3 from a date, tagged", async () => {
			await run([daily("2026-11-01", ["transcribe"])]);
			expectOnly(["d01-t", "d02-t"]);
		});

		it("D4 every daily note, tagged", async () => {
			await run([daily("", ["transcribe"])]);
			expectOnly(["d31-t", "d01-t", "d02-t"]);
		});

		it("D6 a future date selects nothing", async () => {
			const report = await run([daily("2030-01-01")]);
			expect(report.total).toBe(0);
		});

		it("D7 an untagged and a removing tagged daily rule on the same note", async () => {
			await run([daily("2026-11-01"), daily("2026-11-01", ["transcribe"], true)]);
			expect(vault.content(`${DAILY}/2026-11-01.md`)).toBe("text of d01-t\ntext of d01-u");
		});

		it("D5 a date-named note outside the daily folder is not a daily note", async () => {
			addNote("Inbox/2026-11-03.md", "![[dated.m4a]]");
			await run([daily()]);
			expect(transcribed()).not.toContain("dated");
		});
	});

	describe("rules combine with OR", () => {
		const O1 = [daily("2026-11-01"), folders(["Inbox"], ["transcribe"])];

		it("O1 disjoint rules give the union", async () => {
			await run(O1);
			expectOnly(["d01-t", "d01-u", "d02-t", "d02-u", "in-t", "deep-t"]);
		});

		it("O2 each rule keeps its own scope and tags", async () => {
			await run([folders(["Inbox"], ["transcribe"]), folders(["/"], ["voice"])]);
			expectOnly(["in-t", "deep-t", "in-v", "o-v"]);
		});

		it("O3 a reference group selected by two rules is transcribed once", async () => {
			const report = await run([folders(["Inbox"], ["transcribe"]), folders(["/"], ["transcribe"])]);
			expectOnly(ALL_AUDIO.filter((name) => name.endsWith("-t")));
			expect(report.total).toBe(ALL_AUDIO.filter((name) => name.endsWith("-t")).length);
		});

		it("O4 a tagged and an untagged rule on the same folder", async () => {
			const report = await run([folders(["Inbox"], ["transcribe"]), folders(["Inbox"])]);
			expectOnly(["in-t", "in-u", "in-v", "deep-t", "deep-u"]);
			expect(report.total).toBe(5);
		});

		it("O5 rule order does not matter", async () => {
			await run([...O1].reverse());
			expectOnly(["d01-t", "d01-u", "d02-t", "d02-u", "in-t", "deep-t"]);
		});

		it("O6 daily and folder scopes over the same notes", async () => {
			const report = await run([daily(), folders(["Journal"])]);
			expectOnly(["d31-t", "d31-u", "d01-t", "d01-u", "d02-t", "d02-u", "arch-t", "arch-u", "ideas-t", "ideas-u"]);
			expect(report.total).toBe(10);
		});

		it("O8 conflicting removal: a rule that removes wins", async () => {
			await run([folders(["/"], ["transcribe"], true), folders(["Inbox"], ["transcribe"], false)]);
			expect(vault.content("Inbox/n.md")).toBe("text of in-t\n![[in-u.m4a]]\n![[in-v.m4a]] #voice");
		});

		it("O7 a duplicated rule changes nothing", async () => {
			const report = await run([folders(["Inbox"], ["transcribe"]), folders(["Inbox"], ["transcribe"])]);
			expectOnly(["in-t", "deep-t"]);
			expect(report.total).toBe(2);
		});
	});

	describe("tag removal", () => {
		it("R1 removes the tag from the transcribed line only", async () => {
			addNote("Other/idea.md", "- ![[idea-a.m4a]] #transcribe\n- idea #transcribe");
			await run([folders(["Other"], ["transcribe"], true)]);
			expect(vault.content("Other/idea.md")).toBe("- text of idea-a\n- idea #transcribe");
			expect(vault.content("Other/o.md")).toBe("text of o-t\n![[o-u.m4a]]\n![[o-v.m4a]] #voice");
		});

		it("R2 keeps the tag when removal is off", async () => {
			await run([folders(["Other"], ["transcribe"], false)]);
			expect(vault.content("Other/o.md")).toBe("text of o-t #transcribe\n![[o-u.m4a]]\n![[o-v.m4a]] #voice");
		});

		it("R3 removes only the tags of rules that remove", async () => {
			addNote("Other/two.md", "![[two.m4a]] #transcribe #voice");
			await run([folders(["/"], ["transcribe"], true), folders(["/"], ["voice"], false)]);
			expect(vault.content("Other/two.md")).toBe("text of two #voice");
		});

		it("R4 an untagged rule removes no tag", async () => {
			await run([folders(["Other"])]);
			expect(vault.content("Other/o.md")).toBe("text of o-t #transcribe\ntext of o-u\ntext of o-v #voice");
		});

		it("R5 a rule that did not select the note removes nothing there", async () => {
			await run([folders(["Inbox"]), folders(["Other"], ["transcribe"], true)]);
			expect(vault.content("Inbox/n.md")).toBe("text of in-t #transcribe\ntext of in-u\ntext of in-v #voice");
			expect(vault.content("Other/o.md")).toBe("text of o-t\n![[o-u.m4a]]\n![[o-v.m4a]] #voice");
		});

		it("R6 an untagged and a removing tagged rule over the same note", async () => {
			await run([folders(["Inbox"]), folders(["Inbox"], ["transcribe"], true)]);
			expect(vault.content("Inbox/n.md")).toBe("text of in-t\ntext of in-u\ntext of in-v #voice");
		});

		it("R7 tag removal follows the rules that selected each line", async () => {
			await run([daily("2026-11-01"), daily("2026-10-01", ["transcribe"], true)]);
			expect(vault.content(`${DAILY}/2026-10-31.md`)).toBe("text of d31-t\n![[d31-u.m4a]]");
			expect(vault.content(`${DAILY}/2026-11-01.md`)).toBe("text of d01-t\ntext of d01-u");
		});
	});

	describe("references", () => {
		it("A1 an untagged reference to selected audio stays and keeps the audio", async () => {
			addNote("Other/same.md", "![[same.m4a]] #transcribe\nsee ![[same.m4a]]");
			await run([folders(["Other"], ["transcribe"])]);
			expect(vault.content("Other/same.md")).toBe("text of same #transcribe\nsee ![[same.m4a]]");
			expect(vault.trashed).not.toContain("att/same.m4a");
		});

		it("A2 audio also referenced from a note outside the rules is kept there and not trashed", async () => {
			addNote("Other/shared.md", "![[shared.m4a]] #transcribe");
			addNote("Elsewhere/ref.md", "![[shared.m4a]]");
			await run([folders(["Other"], ["transcribe"])]);
			expect(vault.content("Other/shared.md")).toBe("text of shared #transcribe");
			expect(vault.content("Elsewhere/ref.md")).toBe("![[shared.m4a]]");
			expect(vault.trashed).not.toContain("att/shared.m4a");
		});

		it("A3 side-by-side parts on a selected line are one recording", async () => {
			addNote("Other/split.md", "![[p1.m4a]] ![[p2.m4a]] #transcribe\n![[p3.m4a]]");
			const report = await run([folders(["Other"], ["transcribe"], true)]);
			expect(vault.content("Other/split.md")).toBe("text of p1 text of p2\n![[p3.m4a]]");
			expect(report.total).toBe(2);
		});

		it("A1b same audio on a selected and an unselected line, two rules selecting other lines", async () => {
			addNote("Other/mix.md", "![[m.m4a]] #transcribe\n![[m.m4a]]\n![[m2.m4a]] #voice");
			await run([folders(["Other"], ["transcribe"], true), folders(["Other"], ["voice"])]);
			expect(vault.content("Other/mix.md")).toBe("text of m\n![[m.m4a]]\ntext of m2 #voice");
			expect(vault.trashed).not.toContain("att/m.m4a");
		});

		it("A2b transcribed audio also linked from an unselected note", async () => {
			addNote("Elsewhere/link.md", "see [[in-u.m4a]]");
			await run([folders(["Inbox"])]);
			expect(vault.content("Inbox/n.md")).toBe("text of in-t #transcribe\ntext of in-u\ntext of in-v #voice");
			expect(vault.content("Elsewhere/link.md")).toBe("see [[in-u.m4a]]");
			expect(vault.trashed).not.toContain("att/in-u.m4a");
		});

		it("A5 two recordings on one tagged line with removal on", async () => {
			addNote("Other/two.md", "![[ta.m4a]] and ![[tb.m4a]] #transcribe");
			const report = await run([folders(["Other"], ["transcribe"], true)]);
			expect(report.failures).toEqual([]);
			expect(vault.content("Other/two.md")).toBe("text of ta and text of tb");
			expect(vault.trashed).toEqual(expect.arrayContaining(["att/ta.m4a", "att/tb.m4a"]));
		});

		it("A6 a lone part and the same part inside a split recording", async () => {
			for (const content of ["![[sa.m4a]]\n![[sa.m4a]] ![[sb.m4a]]", "![[sa.m4a]] ![[sb.m4a]]\n![[sa.m4a]]"]) {
				vault = new FakeVault();
				transcriber = new FakeTranscriber();
				original = new Map();
				addNote("Other/split.md", content);
				const report = await run([folders(["Other"])]);
				expect(report.failures).toEqual([]);
				expect(vault.content("Other/split.md")).toBe(content.replace("![[sa.m4a]] ![[sb.m4a]]", "text of sa text of sb").replace("![[sa.m4a]]", "text of sa"));
								expect(transcriber.calls).toHaveLength(2);
				expect([...vault.trashed].sort()).toEqual(["att/sa.m4a", "att/sb.m4a"]);
			}
		});

		it("A7 the same audio twice side by side becomes one text", async () => {
			addNote("Other/twice.md", "![[tw.m4a]] ![[tw.m4a]] #transcribe");
			await run([folders(["Other"], ["transcribe"])]);
			expect(vault.content("Other/twice.md")).toBe("text of tw #transcribe");
			expect(transcriber.calls.filter((p) => p.endsWith("tw.m4a"))).toHaveLength(1);
		});

		it("A8 a tag between parts splits them into two recordings", async () => {
			addNote("Other/between.md", "![[ba.m4a]] #transcribe ![[bb.m4a]]");
			const report = await run([folders(["Other"], ["transcribe"])]);
			expect(vault.content("Other/between.md")).toBe("text of ba #transcribe text of bb");
			expect(report.total).toBe(3);
		});

		it("A4 plain links and aliased embeds count as references", async () => {
			addNote("Other/links.md", "[[l1.m4a]] #transcribe\n![[l2.m4a|alias]] #transcribe");
			await run([folders(["Other"], ["transcribe"])]);
			expectOnly(["o-t", "l1", "l2"]);
		});
	});

	describe("current note", () => {
		const runNote = (notePath: string, rules: unknown[]) =>
			new TranscriptionJob(vault, transcriber, new FixedDurations(), journal, new RecordingProgress()).run(
				{ notePath, rules: rules as TranscriptionRule[] },
				new AbortController().signal,
			);

		it("S1 works without rules and transcribes every audio of the note, tags kept", async () => {
			await runNote("Inbox/n.md", []);
			expectOnly(["in-t", "in-u", "in-v"]);
			expect(vault.content("Inbox/n.md")).toBe("text of in-t #transcribe\ntext of in-u\ntext of in-v #voice");
		});

		it("S2 removes the tags of removing rules that cover the note only", async () => {
			addNote("Inbox/cur.md", "![[cur.m4a]] #transcribe #voice #x #zzz");
			await runNote("Inbox/cur.md", [
				folders(["/"], ["transcribe"], true),
				daily("", ["voice"], true),
				folders(["Inbox"], ["x"], false),
				folders(["Other"], ["zzz"], true),
			]);
			expect(vault.content("Inbox/cur.md")).toBe("text of cur #voice #x #zzz");
		});

		it("S3 a daily rule covers a daily note", async () => {
			await runNote(`${DAILY}/2026-11-01.md`, [daily("2026-11-01", ["transcribe"], true)]);
			expect(vault.content(`${DAILY}/2026-11-01.md`)).toBe("text of d01-t\ntext of d01-u");
		});

		it("S4 invalid rules do not block the command and remove nothing", async () => {
			await runNote("Inbox/n.md", [folders(["Inbox"], []), daily("2026-02-30", ["transcribe"], true), null]);
			expect(vault.content("Inbox/n.md")).toBe("text of in-t #transcribe\ntext of in-u\ntext of in-v #voice");
		});

		it("S5 reads and edits no other note", async () => {
			await runNote("Inbox/n.md", [folders(["/"])]);
			expectOnly(["in-t", "in-u", "in-v"]);
		});
	});
});
