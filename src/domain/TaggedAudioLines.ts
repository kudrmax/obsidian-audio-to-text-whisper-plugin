import { InlineTags } from "./InlineTags";
import { AudioEmbed } from "./ports";
import { referencePattern, replaceReference } from "./replaceReference";

interface Occurrence {
	readonly start: number;
	readonly end: number;
	readonly embed: AudioEmbed;
}

/** An audio reference is selected only when a tag stands on the same line; other lines are never touched. */
export class TaggedAudioLines {
	constructor(
		private readonly tags: InlineTags,
		private readonly removeTag: boolean,
	) {}

	/** References side by side on a tagged line, separated only by whitespace, are parts of one recording. */
	groups(content: string, embeds: readonly AudioEmbed[]): AudioEmbed[][] {
		const unique = [...new Map(embeds.map((embed) => [embed.linkText, embed])).values()];
		return content
			.split("\n")
			.filter((line) => this.tags.matches(line))
			.flatMap((line) => adjacentRuns(line, occurrencesIn(line, unique)));
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

function occurrencesIn(line: string, embeds: readonly AudioEmbed[]): Occurrence[] {
	const found = embeds.flatMap((embed) =>
		[...line.matchAll(referencePattern([embed.linkText]))].map((match) => ({
			start: match.index,
			end: match.index + match[0].length,
			embed,
		})),
	);
	return found.sort((a, b) => a.start - b.start);
}

function adjacentRuns(line: string, occurrences: readonly Occurrence[]): AudioEmbed[][] {
	const runs: AudioEmbed[][] = [];
	let previousEnd = -1;
	for (const occurrence of occurrences) {
		if (occurrence.start < previousEnd) continue;
		const adjacent = previousEnd >= 0 && line.slice(previousEnd, occurrence.start).trim() === "";
		if (adjacent) runs[runs.length - 1].push(occurrence.embed);
		else runs.push([occurrence.embed]);
		previousEnd = occurrence.end;
	}
	return runs;
}
