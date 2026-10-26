import { describe, expect, it } from "vitest";
import { AllAudioLines } from "../src/domain/AllAudioLines";
import { InlineTags } from "../src/domain/InlineTags";

describe("AllAudioLines", () => {
	const lines = new AllAudioLines();
	const a = { linkText: "![[a.m4a]]", audioPath: "a.m4a" };
	const b = { linkText: "![[b.m4a]]", audioPath: "b.m4a" };

	it("selects audio on every line, tag or not", () => {
		expect(lines.groups("- 19:23 ![[a.m4a]]\n- ![[b.m4a]] #transcribe", [a, b])).toEqual([[a], [b]]);
	});

	it("groups side-by-side references and ignores duplicates in the embed list", () => {
		expect(lines.groups("![[b.m4a]] ![[a.m4a]]", [a, b, b])).toEqual([[b, a]]);
	});

	it("replaces references on any line and keeps tags", () => {
		expect(lines.replace("- ![[a.m4a]] #transcribe\n- ![[a.m4a]]", ["![[a.m4a]]"], "T")).toBe("- T #transcribe\n- T");
	});

	it("removes the given tags from replaced lines only", () => {
		const removing = new AllAudioLines(new InlineTags(["transcribe"]));
		const content = "- ![[a.m4a]] #transcribe\n- note #transcribe";
		expect(removing.replace(content, ["![[a.m4a]]"], "T")).toBe("- T\n- note #transcribe");
	});
});
