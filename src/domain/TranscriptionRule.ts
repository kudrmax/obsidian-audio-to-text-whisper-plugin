import { FolderScope } from "./FolderScope";
import { InlineTags } from "./InlineTags";
import { LineRule } from "./AudioLines";

export type RuleScope = "folders" | "daily";

/** Conditions inside a rule combine with AND; rules combine with OR. */
export interface TranscriptionRule {
	scope: RuleScope;
	/** Folders scope only; subfolders included, "/" is the whole vault. */
	folders: string[];
	/** Daily scope only; YYYY-MM-DD, empty means any date. */
	fromDate: string;
	onlyTagged: boolean;
	tags: string[];
	removeTagsAfter: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TAG_NAME = /^[\p{L}\p{N}_/-]+$/u;

/** A stored rule checked to be complete and well-formed; anything doubtful is refused, never filled in. */
export class ValidRule {
	private constructor(
		private readonly folders: FolderScope | undefined,
		private readonly fromDate: string | undefined,
		private readonly tags: InlineTags | undefined,
		private readonly removesTags: boolean,
	) {}

	static parse(raw: unknown, number: number): ValidRule {
		const fail = (reason: string): never => {
			throw new Error(`rule ${number}: ${reason}`);
		};
		if (typeof raw !== "object" || raw === null) return fail("is malformed, delete it and add it again");
		const rule = raw as Record<string, unknown>;
		if (rule.scope !== "folders" && rule.scope !== "daily") return fail("is malformed, delete it and add it again");
		if (
			!isStringArray(rule.folders) ||
			typeof rule.fromDate !== "string" ||
			typeof rule.onlyTagged !== "boolean" ||
			!isStringArray(rule.tags) ||
			typeof rule.removeTagsAfter !== "boolean"
		) {
			return fail("is malformed, delete it and add it again");
		}

		let folders: FolderScope | undefined;
		let fromDate: string | undefined;
		if (rule.scope === "folders") {
			folders = FolderScope.of(rule.folders);
			if (!folders) return fail("add a folder, or / for the whole vault");
		} else {
			if (rule.fromDate !== "" && !isRealDate(rule.fromDate)) fail(`"${rule.fromDate}" is not a date in the YYYY-MM-DD form`);
			fromDate = rule.fromDate;
		}

		let tags: InlineTags | undefined;
		if (rule.onlyTagged) {
			const names = rule.tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
			if (names.length === 0) return fail("add a tag or choose Every audio");
			const invalid = names.find((name) => !TAG_NAME.test(name));
			if (invalid !== undefined) return fail(`"${invalid}" is not a tag`);
			tags = new InlineTags(names);
		}
		return new ValidRule(folders, fromDate, tags, rule.removeTagsAfter);
	}

	get needsDailyNotes(): boolean {
		return this.fromDate !== undefined;
	}

	/** `days` maps daily note paths to their YYYY-MM-DD day. */
	covers(notePath: string, days: ReadonlyMap<string, string>): boolean {
		if (this.folders) return this.folders.contains(notePath);
		const day = days.get(notePath);
		return day !== undefined && day >= (this.fromDate ?? "");
	}

	get lineRule(): LineRule {
		return { tags: this.tags, tagsToRemove: this.removedTags };
	}

	get removedTags(): InlineTags | undefined {
		return this.removesTags ? this.tags : undefined;
	}
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRealDate(value: string): boolean {
	const match = ISO_DATE.exec(value);
	if (!match) return false;
	const [, year, month, day] = match.map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
