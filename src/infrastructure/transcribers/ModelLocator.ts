import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { expandHome } from "./ProcessRunner";

/** Models are never downloaded by the plugin: the user places them on disk beforehand. */
export class ModelLocator {
	constructor(
		private readonly engineName: string,
		private readonly searchDirs: readonly string[],
		private readonly preferredFiles: readonly string[],
		private readonly filePattern: RegExp,
	) {}

	locate(configured: string): string {
		if (configured.trim()) {
			const path = expandHome(configured.trim());
			if (!existsSync(path)) throw new Error(`${this.engineName} model file not found: ${path}`);
			return path;
		}
		for (const dir of this.searchDirs.filter((d) => existsSync(d))) {
			const files = readdirSync(dir).filter((f) => this.filePattern.test(f));
			const best = this.preferredFiles.find((m) => files.includes(m)) ?? files[0];
			if (best) return join(dir, best);
		}
		throw new Error(
			`${this.engineName} model not found in ${this.searchDirs.join(", ")}: download a model beforehand or set its path in the plugin settings`,
		);
	}
}
