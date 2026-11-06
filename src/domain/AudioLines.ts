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
	readonly line: string;
	readonly rules: LineRule[];
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HIDDEN_FROM_TAGS = [/`[^`]*`/g, /%%.*?%%/g, /<!--.*?-->/g];

/**
 * Decides which audio references of a note are transcribed and how their lines change afterwards.
 * A line is selected when any rule selects it; frontmatter and fenced code are never selected or edited.
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
		return this.selectedLines(content.split("\n")).flatMap(({ line }) => this.runsIn(line).map((run) => run.embeds));
	}

	/** Replaces exactly the runs made of these references on selected lines; other lines stay byte-for-byte. */
	replace(content: string, references: readonly string[], transcript: string): string {
		const lines = content.split("\n");
		for (const { index, line, rules } of this.selectedLines(lines)) {
			const runs = this.runsIn(line);
			const matching = runs.filter((run) => sameReferences(run, references));
			if (matching.length === 0) continue;
			let updated = line;
			for (const run of [...matching].reverse()) {
				updated = updated.slice(0, run.start) + transcript + updated.slice(run.end);
			}
			if (matching.length === runs.length) {
				for (const rule of rules) if (rule.tagsToRemove) updated = rule.tagsToRemove.removeFrom(updated);
			}
			lines[index] = updated;
		}
		return lines.join("\n");
	}

	private selectedLines(lines: readonly string[]): SelectedLine[] {
		const body = bodyMask(lines);
		const result: SelectedLine[] = [];
		lines.forEach((line, index) => {
			if (!body[index]) return;
			const visible = HIDDEN_FROM_TAGS.reduce((text, pattern) => text.replace(pattern, " "), line);
			const rules = this.rules.filter((rule) => !rule.tags || rule.tags.matches(visible));
			if (rules.length > 0) result.push({ index, line, rules });
		});
		return result;
	}

	/** References on the line, in order; those separated only by whitespace form one run. */
	private runsIn(line: string): Run[] {
		const occurrences = this.embeds
			.flatMap((embed) =>
				[...line.matchAll(referencePattern([embed.linkText]))].map((match) => ({
					start: match.index,
					end: match.index + match[0].length,
					embed,
				})),
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

/** False for frontmatter and fenced code blocks, fences included. */
function bodyMask(lines: readonly string[]): boolean[] {
	const mask = lines.map(() => true);
	let start = 0;
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
		if (end > 0) {
			for (let i = 0; i <= end; i++) mask[i] = false;
			start = end + 1;
		}
	}
	let fence: string | undefined;
	for (let i = start; i < lines.length; i++) {
		const marker = FENCE.exec(lines[i])?.[1];
		if (fence) {
			mask[i] = false;
			if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
		} else if (marker) {
			mask[i] = false;
			fence = marker;
		}
	}
	return mask;
}
