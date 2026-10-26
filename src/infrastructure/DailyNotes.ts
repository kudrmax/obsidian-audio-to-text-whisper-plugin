/** Turns a note's base name into a YYYY-MM-DD day, or undefined when the name is not a date. */
export type DateParser = (basename: string) => string | undefined;

/** Daily notes live directly in one folder and are named by a date; the day order is the ISO string order. */
export class DailyNotes {
	constructor(
		private readonly folder: string,
		private readonly parse: DateParser,
	) {}

	datedFrom(fromDate: string, paths: readonly string[]): string[] {
		return paths.filter((path) => {
			const day = this.dayOf(path);
			return day !== undefined && day >= fromDate;
		});
	}

	private dayOf(path: string): string | undefined {
		const slash = path.lastIndexOf("/");
		const folder = slash < 0 ? "" : path.slice(0, slash);
		if (folder !== this.folder) return undefined;
		return this.parse(path.slice(slash + 1).replace(/\.md$/, ""));
	}
}
