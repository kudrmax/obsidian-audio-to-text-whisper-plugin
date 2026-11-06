import { describe, expect, it } from "vitest";
import { AudioLines } from "../src/domain/AudioLines";
import { InlineTags } from "../src/domain/InlineTags";

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

describe("AudioLines", () => {
	const transcribe = new InlineTags(["transcribe"]);
	const a = { linkText: "![[a.m4a]]", audioPath: "a.m4a" };
	const b = { linkText: "![[b.m4a]]", audioPath: "b.m4a" };
	const c = { linkText: "[[c.m4a]]", audioPath: "c.m4a" };
	const embeds = [a, b, c];
	const every = new AudioLines([{}], embeds);
	const tagged = new AudioLines([{ tags: transcribe, tagsToRemove: transcribe }], embeds);
	const taggedKeeping = new AudioLines([{ tags: transcribe }], embeds);

	it("selects audio on every line when a rule has no tags", () => {
		expect(every.groups("- 19:23 ![[a.m4a]]\n- ![[b.m4a]] #transcribe")).toEqual([[a], [b]]);
	});

	it("selects only tagged lines when every rule has tags", () => {
		expect(tagged.groups("![[a.m4a]]\n#transcribe")).toEqual([]);
		expect(tagged.groups("- ![[a.m4a]] #transcribe")).toEqual([[a]]);
	});

	it("groups side-by-side references in the order they stand, ignoring duplicates in the embed list", () => {
		expect(new AudioLines([{}], [a, b, b, c]).groups("- ![[b.m4a]] ![[a.m4a]]![[c.m4a]]")).toEqual([[b, a]]);
	});

	it("splits references separated by other text", () => {
		expect(every.groups("![[a.m4a]] x [[c.m4a]]")).toEqual([[a], [c]]);
	});

	it("does not confuse a plain link with an embed", () => {
		expect(tagged.replace("![[a.m4a]] #transcribe", ["[[a.m4a]]"], "T")).toBe("![[a.m4a]] #transcribe");
	});

	it("replaces and untags only selected lines", () => {
		const content = "- ![[a.m4a]] #transcribe\n- ![[a.m4a]]\n- note #transcribe";
		expect(tagged.replace(content, ["![[a.m4a]]"], "Текст")).toBe("- Текст\n- ![[a.m4a]]\n- note #transcribe");
	});

	it("keeps the tag when the rule does not remove it", () => {
		expect(taggedKeeping.replace("![[a.m4a]] #transcribe", ["![[a.m4a]]"], "T")).toBe("T #transcribe");
	});

	it("replaces a lone reference but not the same reference inside a longer run", () => {
		expect(every.replace("![[a.m4a]]\n![[a.m4a]] ![[b.m4a]]", ["![[a.m4a]]"], "T")).toBe("T\n![[a.m4a]] ![[b.m4a]]");
	});

	it("keeps the tag until the last recording of the line is transcribed", () => {
		const once = tagged.replace("![[a.m4a]] and ![[b.m4a]] #transcribe", ["![[a.m4a]]"], "A");
		expect(once).toBe("A and ![[b.m4a]] #transcribe");
		expect(tagged.replace(once, ["![[b.m4a]]"], "B")).toBe("A and B");
	});

	it("never selects frontmatter or fenced code", () => {
		const content = "---\nx: ![[a.m4a]] #transcribe\n---\n````\n![[a.m4a]] #transcribe\n```\nstill code ![[a.m4a]]\n````\n![[b.m4a]]";
		expect(every.groups(content)).toEqual([[b]]);
		expect(every.replace(content, ["![[a.m4a]]"], "T")).toBe(content);
	});

	it("ignores tags in inline code and comments", () => {
		expect(tagged.groups("![[a.m4a]] `#transcribe` %%#transcribe%% <!-- #transcribe -->")).toEqual([]);
	});

	it("never removes a tag inside inline code, a comment or the transcript", () => {
		expect(tagged.replace("![[a.m4a]] #transcribe `x #transcribe`", ["![[a.m4a]]"], "T")).toBe("T `x #transcribe`");
		expect(tagged.replace("![[a.m4a]] #transcribe %% keep #transcribe %%", ["![[a.m4a]]"], "T")).toBe("T %% keep #transcribe %%");
		expect(tagged.replace("![[a.m4a]] #transcribe", ["![[a.m4a]]"], "say #transcribe")).toBe("say #transcribe");
	});

	it("never rewrites a reference inside inline code or a comment", () => {
		expect(every.replace("![[a.m4a]]\nsyntax: `![[a.m4a]]`", ["![[a.m4a]]"], "T")).toBe("T\nsyntax: `![[a.m4a]]`");
		expect(tagged.replace("![[a.m4a]] #transcribe and `![[a.m4a]]`", ["![[a.m4a]]"], "T")).toBe("T and `![[a.m4a]]`");
		expect(every.replace("![[a.m4a]] %% ![[a.m4a]] %% <!-- ![[a.m4a]] -->", ["![[a.m4a]]"], "T")).toBe(
			"T %% ![[a.m4a]] %% <!-- ![[a.m4a]] -->",
		);
	});

	it("hides multi-line comments, unclosed ones to the end of the note", () => {
		expect(tagged.groups("%%\n![[a.m4a]] #transcribe\n%%")).toEqual([]);
		expect(tagged.groups("<!--\n![[a.m4a]] #transcribe\n-->")).toEqual([]);
		expect(every.groups("![[b.m4a]]\n%% unclosed\n![[a.m4a]]")).toEqual([[b]]);
	});

	it("does not close a fence with a line carrying an info string, and sees fences in quotes", () => {
		expect(every.groups("```\n```js\n![[a.m4a]]\n```\n![[b.m4a]]")).toEqual([[b]]);
		expect(every.groups("> ```\n> ![[a.m4a]]\n> ```\n![[b.m4a]]")).toEqual([[b]]);
	});

	it("hides code spans of several backticks and a %% inside them", () => {
		expect(every.groups("``x ![[a.m4a]] y``")).toEqual([]);
		expect(every.replace("``x ![[a.m4a]] y``\n![[a.m4a]]", ["![[a.m4a]]"], "T")).toBe("``x ![[a.m4a]] y``\nT");
		expect(tagged.groups("![[a.m4a]] ``#transcribe``")).toEqual([]);
		expect(every.groups("``%%`` text\n%% ![[b.m4a]] %%")).toEqual([]);
		expect(every.groups("```![[a.m4a]]```\n![[b.m4a]]")).toEqual([[b]]);
	});

	it("hides a code span across lines but not across a blank line", () => {
		expect(every.groups("`a\n![[a.m4a]]\nb`")).toEqual([]);
		expect(every.groups("`a\n\n![[a.m4a]]\n\nb`")).toEqual([[a]]);
	});

	it("removes a tag that directly follows a code span", () => {
		expect(tagged.replace("![[a.m4a]] `x`#transcribe", ["![[a.m4a]]"], "T")).toBe("T `x`");
	});

	it("does not treat a #word inside a link as a tag", () => {
		expect(tagged.groups("![[a.m4a]] [[Some note#transcribe]]")).toEqual([]);
		expect(tagged.groups("![[a.m4a]] [see #transcribe](http://x)")).toEqual([]);
	});

	it("keeps emoji and text around the run intact", () => {
		expect(tagged.replace("🎙️ ![[a.m4a]] #transcribe 👍", ["![[a.m4a]]"], "T")).toBe("🎙️ T 👍");
	});
});

describe("InlineTags with combining marks", () => {
	it("does not match a tag that continues with a combining mark", () => {
		expect(new InlineTags(["cafe"]).matches("#cafe\u0301")).toBe(false);
	});
});
