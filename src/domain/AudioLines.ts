import { HiddenText } from "./HiddenText";
import { InlineTags } from "./InlineTags";
import { AudioEmbed } from "./ports";
import { referencePattern } from "./referencePattern";

/** How one rule picks lines of a note: lines with any of `tags`, or every line when there are none. */
export interface LineRule {
	readonly tags?: InlineTags;
	/** Removed from a selected line once its last reference has been transcribed. */
	readonly tagsToRemove?: InlineTags;
}

interface Run {
	readonly start: number;
	readonly end: number;
	readonly embeds: AudioEmbed[];
}

interface SelectedLine {
	readonly index: number;
	readonly start: number;
	readonly line: string;
	readonly rules: LineRule[];
}

/**
 * Decides which audio references of a note are transcribed and how their lines change afterwards.
 * A line is selected when any rule selects it. Frontmatter, code and comments are never transcribed or edited,
 * and a #word inside them or inside a link is not a tag.
 * References standing side by side form one run: parts of one recording that become one text.
 */
export class AudioLines {
	private readonly embeds: AudioEmbed[];

	constructor(
		private readonly rules: readonly LineRule[],
		embeds: readonly AudioEmbed[],
	) {
		this.embeds = [...new Map(embeds.map((embed) => [embed.linkText, embed])).values()];
	}

	groups(content: string): AudioEmbed[][] {
		const hidden = new HiddenText(content);
		return this.selectedLines(content, hidden).flatMap(({ line, start }) =>
			this.runsIn(line, hidden.code.slice(start, start + line.length)).map((run) => run.embeds),
		);
	}

	/** Replaces exactly the runs made of these references on selected lines; other lines stay byte-for-byte. */
	replace(content: string, references: readonly string[], transcript: string): string {
		const hidden = new HiddenText(content);
		const lines = content.split("\n");
		for (const { index, start, line, rules } of this.selectedLines(content, hidden)) {
			const runs = this.runsIn(line, hidden.code.slice(start, start + line.length));
			const matching = runs.filter((run) => sameReferences(run, references));
			if (matching.length === 0) continue;
			let updated = line;
			const tagHidden = hidden.tags.slice(start, start + line.length);
			for (const run of [...matching].reverse()) {
				updated = updated.slice(0, run.start) + transcript + updated.slice(run.end);
				tagHidden.splice(run.start, run.end - run.start, ...new Array<boolean>(transcript.length).fill(true));
			}
			if (matching.length === runs.length) {
				for (const rule of rules) if (rule.tagsToRemove) updated = removeVisibleTags(updated, tagHidden, rule.tagsToRemove);
			}
			lines[index] = updated;
		}
		return lines.join("\n");
	}

	private selectedLines(content: string, hidden: HiddenText): SelectedLine[] {
		const visible = hidden.blank(content, hidden.tags).split("\n");
		const result: SelectedLine[] = [];
		let start = 0;
		content.split("\n").forEach((line, index) => {
			const rules = this.rules.filter((rule) => !rule.tags || rule.tags.matches(visible[index]));
			if (rules.length > 0) result.push({ index, start, line, rules });
			start += line.length + 1;
		});
		return result;
	}

	/** Visible references on the line, in order; those separated only by whitespace form one run. */
	private runsIn(line: string, hidden: readonly boolean[]): Run[] {
		const occurrences = this.embeds
			.flatMap((embed) =>
				[...line.matchAll(referencePattern([embed.linkText]))]
					.filter((match) => !hidden[match.index])
					.map((match) => ({ start: match.index, end: match.index + match[0].length, embed })),
			)
			.sort((a, b) => a.start - b.start);
		const runs: { start: number; end: number; embeds: AudioEmbed[] }[] = [];
		for (const occurrence of occurrences) {
			const last = runs[runs.length - 1];
			if (last && occurrence.start < last.end) continue;
			if (last && line.slice(last.end, occurrence.start).trim() === "") {
				last.embeds.push(occurrence.embed);
				last.end = occurrence.end;
			} else {
				runs.push({ start: occurrence.start, end: occurrence.end, embeds: [occurrence.embed] });
			}
		}
		return runs;
	}
}

function sameReferences(run: Run, references: readonly string[]): boolean {
	return run.embeds.length === references.length && run.embeds.every((embed, i) => embed.linkText === references[i]);
}

/** Removes the tags only from the visible stretches of the line, never from code, comments, links or the transcript. */
function removeVisibleTags(line: string, hidden: readonly boolean[], tags: InlineTags): string {
	let result = "";
	let from = 0;
	for (let i = 1; i <= line.length; i++) {
		if (i < line.length && hidden[i] === hidden[from]) continue;
		const stretch = line.slice(from, i);
		result += hidden[from] ? stretch : tags.removeFrom(stretch);
		from = i;
	}
	return result;
}
