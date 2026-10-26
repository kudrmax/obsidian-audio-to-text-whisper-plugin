import { adjacentRuns, AudioLines, uniqueEmbeds } from "./AudioLines";
import { InlineTags } from "./InlineTags";
import { AudioEmbed } from "./ports";
import { referencePattern, replaceReference } from "./replaceReference";

/** Every audio reference in the note is selected, no tag needed. */
export class AllAudioLines implements AudioLines {
	constructor(private readonly tagsToRemove?: InlineTags) {}

	groups(content: string, embeds: readonly AudioEmbed[]): AudioEmbed[][] {
		const unique = uniqueEmbeds(embeds);
		return content.split("\n").flatMap((line) => adjacentRuns(line, unique));
	}

	replace(content: string, references: readonly string[], transcript: string): string {
		return content
			.split("\n")
			.map((line) => {
				if (!referencePattern(references).test(line)) return line;
				const replaced = replaceReference(line, references, transcript);
				return this.tagsToRemove ? this.tagsToRemove.removeFrom(replaced) : replaced;
			})
			.join("\n");
	}
}
