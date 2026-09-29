function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A plain link `[[x]]` is a substring of the embed `![[x]]`, so it must not match when preceded by `!`. */
export function replaceReference(content: string, reference: string, replacement: string): string {
	const guard = reference.startsWith("!") ? "" : "(?<!!)";
	return content.replace(new RegExp(guard + escapeRegExp(reference), "g"), () => replacement);
}
