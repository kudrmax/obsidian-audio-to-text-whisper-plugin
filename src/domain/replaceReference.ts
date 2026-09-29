function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A plain link `[[x]]` is a substring of the embed `![[x]]`, so it must not match when preceded by `!`. */
export function referencePattern(reference: string): RegExp {
	const guard = reference.startsWith("!") ? "" : "(?<!!)";
	return new RegExp(guard + escapeRegExp(reference), "g");
}

export function replaceReference(content: string, reference: string, replacement: string): string {
	return content.replace(referencePattern(reference), () => replacement);
}
