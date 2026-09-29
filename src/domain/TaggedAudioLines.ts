import { InlineTags } from "./InlineTags";
import { referencePattern, replaceReference } from "./replaceReference";

/** An audio reference is selected only when a tag stands on the same line; other lines are never touched. */
export class TaggedAudioLines {
	constructor(
		private readonly tags: InlineTags,
		private readonly removeTag: boolean,
	) {}

	contains(content: string, reference: string): boolean {
		return content.split("\n").some((line) => this.isTagged(line, reference));
	}

	replace(content: string, reference: string, transcript: string): string {
		return content
			.split("\n")
			.map((line) => {
				if (!this.isTagged(line, reference)) return line;
				const replaced = replaceReference(line, reference, transcript);
				return this.removeTag ? this.tags.removeFrom(replaced) : replaced;
			})
			.join("\n");
	}

	private isTagged(line: string, reference: string): boolean {
		return referencePattern(reference).test(line) && this.tags.matches(line);
	}
}
