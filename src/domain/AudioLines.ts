import { AudioEmbed } from "./ports";
import { referencePattern } from "./replaceReference";

/** Decides which audio references of a note are transcribed and how their lines change afterwards. */
export interface AudioLines {
	/** Groups of references to transcribe; references side by side on one line are parts of one recording. */
	groups(content: string, embeds: readonly AudioEmbed[]): AudioEmbed[][];
	replace(content: string, references: readonly string[], transcript: string): string;
}

interface Occurrence {
	readonly start: number;
	readonly end: number;
	readonly embed: AudioEmbed;
}

export function uniqueEmbeds(embeds: readonly AudioEmbed[]): AudioEmbed[] {
	return [...new Map(embeds.map((embed) => [embed.linkText, embed])).values()];
}

/** References on the line, in order; those separated only by whitespace form one run. */
export function adjacentRuns(line: string, embeds: readonly AudioEmbed[]): AudioEmbed[][] {
	const runs: AudioEmbed[][] = [];
	let previousEnd = -1;
	for (const occurrence of occurrencesIn(line, embeds)) {
		if (occurrence.start < previousEnd) continue;
		const adjacent = previousEnd >= 0 && line.slice(previousEnd, occurrence.start).trim() === "";
		if (adjacent) runs[runs.length - 1].push(occurrence.embed);
		else runs.push([occurrence.embed]);
		previousEnd = occurrence.end;
	}
	return runs;
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
