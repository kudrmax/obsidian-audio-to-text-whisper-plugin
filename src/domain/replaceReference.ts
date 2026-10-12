function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the references in this order with only whitespace between them.
 * A plain link `[[x]]` is a substring of the embed `![[x]]`, so it must not match when preceded by `!`.
 */
export function referencePattern(references: readonly string[]): RegExp {
	const guard = references[0].startsWith("!") ? "" : "(?<!!)";
	return new RegExp(guard + references.map(escapeRegExp).join("\\s*"), "g");
}

export function replaceReference(content: string, references: readonly string[], replacement: string): string {
	return content.replace(referencePattern(references), () => replacement);
}
