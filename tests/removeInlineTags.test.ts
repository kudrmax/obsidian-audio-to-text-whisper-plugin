import { describe, expect, it } from "vitest";
import { removeInlineTags } from "../src/domain/removeInlineTags";

describe("removeInlineTags", () => {
	it("removes the tag at line end, middle and start", () => {
		expect(removeInlineTags("- text #transcribe", ["transcribe"])).toBe("- text");
		expect(removeInlineTags("a #transcribe b", ["transcribe"])).toBe("a b");
		expect(removeInlineTags("#transcribe b", ["transcribe"])).toBe("b");
	});

	it("is case-insensitive and supports cyrillic tags", () => {
		expect(removeInlineTags("x #Распознать\ny #transcribe", ["распознать", "#transcribe"])).toBe("x\ny");
	});

	it("keeps longer tags, nested tags and heading links", () => {
		const content = "#transcribed #transcribe/later [[note#transcribe]] a#transcribe";
		expect(removeInlineTags(content, ["transcribe"])).toBe(content);
	});
});
