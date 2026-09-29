import { describe, expect, it } from "vitest";
import { InlineTags } from "../src/domain/InlineTags";
import { TaggedAudioLines } from "../src/domain/TaggedAudioLines";
import { replaceReference } from "../src/domain/replaceReference";

describe("InlineTags", () => {
	const tags = new InlineTags(["transcribe", "#Распознать"]);

	it("removes the tag at line end, middle and start", () => {
		expect(tags.removeFrom("- text #transcribe")).toBe("- text");
		expect(tags.removeFrom("a #transcribe b")).toBe("a b");
		expect(tags.removeFrom("#transcribe b")).toBe("b");
	});

	it("is case-insensitive and supports cyrillic tags", () => {
		expect(tags.matches("x #распознать")).toBe(true);
		expect(tags.removeFrom("x #РАСПОЗНАТЬ")).toBe("x");
	});

	it("ignores longer tags, nested tags and heading links", () => {
		const line = "#transcribed #transcribe/later [[note#transcribe]] a#transcribe";
		expect(tags.matches(line)).toBe(false);
		expect(tags.removeFrom(line)).toBe(line);
	});

	it("is empty when no non-blank tags are given", () => {
		expect(new InlineTags([" ", "#"]).isEmpty).toBe(true);
	});
});

describe("TaggedAudioLines", () => {
	const lines = new TaggedAudioLines(new InlineTags(["transcribe"]), true);

	it("finds a reference only on a tagged line", () => {
		expect(lines.contains("![[a.m4a]]\n#transcribe", "![[a.m4a]]")).toBe(false);
		expect(lines.contains("- ![[a.m4a]] #transcribe", "![[a.m4a]]")).toBe(true);
	});

	it("does not confuse a plain link with an embed", () => {
		expect(lines.contains("![[a.m4a]] #transcribe", "[[a.m4a]]")).toBe(false);
	});

	it("replaces and untags only tagged lines", () => {
		const content = "- ![[a.m4a]] #transcribe\n- ![[a.m4a]]\n- note #transcribe";
		expect(lines.replace(content, "![[a.m4a]]", "Текст")).toBe("- Текст\n- ![[a.m4a]]\n- note #transcribe");
	});

	it("keeps the tag when removal is off", () => {
		const keeping = new TaggedAudioLines(new InlineTags(["transcribe"]), false);
		expect(keeping.replace("![[a.m4a]] #transcribe", "![[a.m4a]]", "T")).toBe("T #transcribe");
	});
});

describe("replaceReference", () => {
	it("treats regex characters and $ in replacement literally", () => {
		expect(replaceReference("[a](rec (1).m4a)", "[a](rec (1).m4a)", "cost $1")).toBe("cost $1");
	});
});
