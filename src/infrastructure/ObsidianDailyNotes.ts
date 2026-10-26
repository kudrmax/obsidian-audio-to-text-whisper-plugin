import { App, moment, normalizePath } from "obsidian";
import { DailyNotes } from "./DailyNotes";

export interface DailyNotesConfig {
	readonly folder: string;
	readonly format: string;
}

interface DailyNotesPlugin {
	enabled?: boolean;
	instance?: { options?: { folder?: string; format?: string } };
}

const DEFAULT_FORMAT = "YYYY-MM-DD";

/** Obsidian's moment is typed as a namespace, which TypeScript refuses to call under esModuleInterop. */
type StrictParser = (input: string, format: string, strict: true) => { isValid(): boolean; format(pattern: string): string };
const parseMoment = moment as unknown as StrictParser;

/** Reads the core Daily notes plugin settings; undefined when the plugin is off. */
export function dailyNotesConfig(app: App): DailyNotesConfig | undefined {
	const internal = (app as unknown as { internalPlugins?: { getPluginById?: (id: string) => DailyNotesPlugin | undefined } })
		.internalPlugins;
	const plugin = internal?.getPluginById?.("daily-notes");
	if (!plugin?.enabled) return undefined;
	const options = plugin.instance?.options ?? {};
	const folder = normalizePath(options.folder?.trim() || "/");
	return { folder: folder === "/" ? "" : folder, format: options.format?.trim() || DEFAULT_FORMAT };
}

export function dailyNotesOf(config: DailyNotesConfig): DailyNotes {
	return new DailyNotes(config.folder, (basename) => {
		const parsed = parseMoment(basename, config.format, true);
		return parsed.isValid() ? parsed.format("YYYY-MM-DD") : undefined;
	});
}
