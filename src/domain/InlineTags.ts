function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class InlineTags {
	private readonly names: readonly string[];

	constructor(tags: readonly string[]) {
		this.names = tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
	}

	get isEmpty(): boolean {
		return this.names.length === 0;
	}

	matches(line: string): boolean {
		return this.names.some((name) => this.pattern(name).test(line));
	}

	removeFrom(line: string): string {
		return this.names.reduce(
			(text, name) => text.replace(this.pattern(name), (_m, before: string, after: string) => (before && after ? " " : "")),
			line,
		);
	}

	private pattern(name: string): RegExp {
		return new RegExp(`(^|[ \\t]+)#${escapeRegExp(name)}(?![\\p{L}\\p{N}_/-])([ \\t]*)`, "gimu");
	}
}
