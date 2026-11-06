import { DatedNote } from "../domain/ports";

/** Turns a note's path below the daily notes folder, without extension, into a YYYY-MM-DD day, or undefined when it is not a date. */
export type DateParser = (relativePath: string) => string | undefined;

/** Daily notes live in one folder and are named by a date format, which may contain slashes. */
export class DailyNotes {
	private readonly prefix: string;

	constructor(
		folder: string,
		private readonly parse: DateParser,
	) {
		const normalized = folder.normalize("NFC");
		this.prefix = normalized ? `${normalized}/` : "";
	}

	dated(paths: readonly string[]): DatedNote[] {
		return paths.flatMap((path) => {
			const day = this.dayOf(path);
			return day === undefined ? [] : [{ path, day }];
		});
	}

	private dayOf(path: string): string | undefined {
		const normalized = path.normalize("NFC");
		if (!normalized.endsWith(".md") || !normalized.startsWith(this.prefix)) return undefined;
		return this.parse(normalized.slice(this.prefix.length, -".md".length));
	}
}
