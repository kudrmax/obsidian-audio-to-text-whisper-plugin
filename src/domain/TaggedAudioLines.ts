import { adjacentRuns, AudioLines, uniqueEmbeds } from "./AudioLines";
import { InlineTags } from "./InlineTags";
import { AudioEmbed } from "./ports";
import { referencePattern, replaceReference } from "./replaceReference";

/** An audio reference is selected only when a tag stands on the same line; other lines are never touched. */
export class TaggedAudioLines implements AudioLines {
	constructor(
		private readonly tags: InlineTags,
		private readonly removeTag: boolean,
	) {}

	groups(content: string, embeds: readonly AudioEmbed[]): AudioEmbed[][] {
		const unique = uniqueEmbeds(embeds);
		return content
			.split("\n")
			.filter((line) => this.tags.matches(line))
			.flatMap((line) => adjacentRuns(line, unique));
	}

	contains(content: string, references: readonly string[]): boolean {
		return content.split("\n").some((line) => this.isTagged(line, references));
	}

	replace(content: string, references: readonly string[], transcript: string): string {
		return content
			.split("\n")
			.map((line) => {
				if (!this.isTagged(line, references)) return line;
				const replaced = replaceReference(line, references, transcript);
				return this.removeTag ? this.tags.removeFrom(replaced) : replaced;
			})
			.join("\n");
	}

	private isTagged(line: string, references: readonly string[]): boolean {
		return referencePattern(references).test(line) && this.tags.matches(line);
	}
}
