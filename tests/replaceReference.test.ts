import { describe, expect, it } from "vitest";
import { replaceReference } from "../src/domain/replaceReference";

describe("replaceReference", () => {
	const content = "a ![[x.m4a]] b [[x.m4a]] c [[x.m4a]]";

	it("replaces only plain links, leaving embeds intact", () => {
		expect(replaceReference(content, "[[x.m4a]]", "T")).toBe("a ![[x.m4a]] b T c T");
	});

	it("replaces embeds", () => {
		expect(replaceReference(content, "![[x.m4a]]", "T")).toBe("a T b [[x.m4a]] c [[x.m4a]]");
	});

	it("treats regex characters and $ in replacement literally", () => {
		expect(replaceReference("[a](rec (1).m4a)", "[a](rec (1).m4a)", "cost $1")).toBe("cost $1");
	});
});
