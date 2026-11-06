const FENCE_OPEN = /^\s*(?:>\s*)*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(?:>\s*)*(`{3,}|~{3,})\s*$/;
const COMMENTS = [/%%[\s\S]*?(?:%%|$)/g, /<!--[\s\S]*?(?:-->|$)/g];
const INLINE_CODE = /`[^`\n]*`/g;
const LINKS = [/!?\[\[[^\]\n]*\]\]/g, /\[[^\]\n]*\]\([^)\n]*\)/g];

/**
 * Marks the characters of a note that are not plain body text.
 * `code`: frontmatter, fenced code, inline code and comments; references there are never transcribed or edited.
 * `tags`: `code` plus link texts, where a #word is not a tag.
 */
export class HiddenText {
	readonly code: boolean[];
	readonly tags: boolean[];

	constructor(content: string) {
		this.code = new Array<boolean>(content.length).fill(false);
		this.hideBlocks(content);
		let visible = this.blank(content, this.code);
		for (const pattern of [INLINE_CODE, ...COMMENTS]) {
			this.hideMatches(visible, pattern, this.code);
			visible = this.blank(content, this.code);
		}
		this.tags = [...this.code];
		for (const pattern of LINKS) this.hideMatches(visible, pattern, this.tags);
	}

	/** The text with hidden characters replaced by spaces; line breaks are kept. */
	blank(content: string, mask: readonly boolean[]): string {
		let text = "";
		for (let i = 0; i < content.length; i++) text += mask[i] && content[i] !== "\n" ? " " : content[i];
		return text;
	}

	private hideBlocks(content: string): void {
		const lines = content.split("\n");
		const starts: number[] = [];
		let offset = 0;
		for (const line of lines) {
			starts.push(offset);
			offset += line.length + 1;
		}
		const hideLine = (index: number) => this.code.fill(true, starts[index], starts[index] + lines[index].length);

		let first = 0;
		if (lines[0]?.trim() === "---") {
			const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
			if (end > 0) {
				for (let i = 0; i <= end; i++) hideLine(i);
				first = end + 1;
			}
		}
		let fence: string | undefined;
		for (let i = first; i < lines.length; i++) {
			if (fence) {
				hideLine(i);
				const closing = FENCE_CLOSE.exec(lines[i])?.[1];
				if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = undefined;
				continue;
			}
			const opening = FENCE_OPEN.exec(lines[i])?.[1];
			if (opening) {
				hideLine(i);
				fence = opening;
			}
		}
	}

	private hideMatches(text: string, pattern: RegExp, mask: boolean[]): void {
		for (const match of text.matchAll(pattern)) mask.fill(true, match.index, match.index + match[0].length);
	}
}
