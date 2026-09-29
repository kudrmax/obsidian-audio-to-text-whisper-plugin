function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeInlineTags(content: string, tags: readonly string[]): string {
	return tags.reduce((text, tag) => {
		const pattern = new RegExp(`(^|[ \\t]+)#${escapeRegExp(tag.replace(/^#/, ""))}(?![\\p{L}\\p{N}_/-])([ \\t]*)`, "gimu");
		return text.replace(pattern, (_match, before: string, after: string) => (before && after ? " " : ""));
	}, content);
}
