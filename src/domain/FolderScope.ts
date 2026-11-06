/** Folders with their subfolders; "/" is the whole vault. Names are compared case-sensitively in NFC form. */
export class FolderScope {
	private constructor(
		private readonly prefixes: readonly string[],
		private readonly wholeVault: boolean,
	) {}

	/** Blank entries are ignored; undefined when nothing is left. */
	static of(folders: readonly string[]): FolderScope | undefined {
		const names = folders.map((folder) => folder.normalize("NFC").trim()).filter(Boolean);
		if (names.length === 0) return undefined;
		const normalized = names.map((name) => name.replace(/\/+/g, "/").replace(/^\/|\/$/g, ""));
		return new FolderScope(
			normalized.filter(Boolean).map((name) => `${name}/`),
			normalized.some((name) => name === ""),
		);
	}

	contains(path: string): boolean {
		if (this.wholeVault) return true;
		const normalized = path.normalize("NFC");
		return this.prefixes.some((prefix) => normalized.startsWith(prefix));
	}
}
