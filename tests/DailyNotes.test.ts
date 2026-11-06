import { describe, expect, it } from "vitest";
import { DailyNotes } from "../src/infrastructure/DailyNotes";

describe("DailyNotes", () => {
	const parse = (name: string) => (/^\d{4}-\d{2}-\d{2}$/.test(name) ? name : undefined);
	const notes = new DailyNotes("Journal/Daily notes", parse);

	it("dates the notes directly in the folder named by a date", () => {
		const paths = [
			"Journal/Daily notes/2026-10-26.md",
			"Journal/Daily notes/2026-10-01.md",
			"Journal/Daily notes/2026-09-30.md",
			"Journal/Daily notes/Raw/2026-10-26.md",
			"Journal/Daily notes/Добавить событие.md",
			"Inbox/2026-10-26.md",
		];
		expect(notes.dated(paths)).toEqual([
			{ path: "Journal/Daily notes/2026-10-26.md", day: "2026-10-26" },
			{ path: "Journal/Daily notes/2026-10-01.md", day: "2026-10-01" },
			{ path: "Journal/Daily notes/2026-09-30.md", day: "2026-09-30" },
		]);
	});

	it("treats an empty folder as the vault root", () => {
		expect(new DailyNotes("", parse).dated(["2026-10-26.md", "a/2026-10-26.md"])).toEqual([{ path: "2026-10-26.md", day: "2026-10-26" }]);
	});

	it("parses the path below the folder, so formats with slashes work", () => {
		const nested = (name: string) => /^\d{4}\/\d{2}\/(\d{4}-\d{2}-\d{2})$/.exec(name)?.[1];
		const paths = ["Journal/2026/11/2026-11-02.md", "Journal/2026-11-02.md", "Journal/2026/11/notes.md"];
		expect(new DailyNotes("Journal", nested).dated(paths)).toEqual([{ path: "Journal/2026/11/2026-11-02.md", day: "2026-11-02" }]);
	});

	it("returns the parsed day, whatever the note name format", () => {
		const dotted = (name: string) => {
			const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(name);
			return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
		};
		expect(new DailyNotes("D", dotted).dated(["D/31.10.2026.md", "D/01.11.2026.md"])).toEqual([
			{ path: "D/31.10.2026.md", day: "2026-10-31" },
			{ path: "D/01.11.2026.md", day: "2026-11-01" },
		]);
	});

	it("matches the folder whatever its unicode form", () => {
		const folder = "Дневник/Ёжик".normalize("NFC");
		const path = "Дневник/Ёжик/2026-11-02.md".normalize("NFD");
		expect(new DailyNotes(folder, parse).dated([path])).toEqual([{ path, day: "2026-11-02" }]);
	});
});
