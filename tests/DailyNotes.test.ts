import { describe, expect, it } from "vitest";
import { DailyNotes } from "../src/infrastructure/DailyNotes";

describe("DailyNotes", () => {
	const parse = (name: string) => (/^\d{4}-\d{2}-\d{2}$/.test(name) ? name : undefined);
	const notes = new DailyNotes("Journal/Daily notes", parse);

	it("selects notes in the folder dated on or after the day", () => {
		const paths = [
			"Journal/Daily notes/2026-10-26.md",
			"Journal/Daily notes/2026-10-01.md",
			"Journal/Daily notes/2026-09-30.md",
			"Journal/Daily notes/Raw/2026-10-26.md",
			"Journal/Daily notes/Добавить событие.md",
			"Inbox/2026-10-26.md",
		];
		expect(notes.datedFrom("2026-10-01", paths)).toEqual(["Journal/Daily notes/2026-10-26.md", "Journal/Daily notes/2026-10-01.md"]);
	});

	it("treats an empty folder as the vault root", () => {
		expect(new DailyNotes("", parse).datedFrom("2026-01-01", ["2026-10-26.md", "a/2026-10-26.md"])).toEqual(["2026-10-26.md"]);
	});
});
