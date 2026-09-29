import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const COMMON_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local/bin"), "/usr/bin"];

export function expandHome(path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : path;
}

export class BinaryLocator {
	/** GUI apps on macOS don't inherit the shell PATH, so well-known Homebrew/pip locations are probed explicitly. */
	static locate(configured: string, names: readonly string[]): string {
		if (configured.trim()) {
			const path = expandHome(configured.trim());
			if (!existsSync(path)) throw new Error(`не найден исполняемый файл: ${path}`);
			return path;
		}
		for (const dir of COMMON_BIN_DIRS) {
			for (const name of names) {
				const candidate = join(dir, name);
				if (existsSync(candidate)) return candidate;
			}
		}
		throw new Error(`не найден ${names.join(" / ")}: установите его или укажите путь в настройках`);
	}
}

export class ProcessRunner {
	constructor(private readonly extraBinDirs: readonly string[] = []) {}

	run(binary: string, args: readonly string[], signal: AbortSignal): Promise<string> {
		const path = [dirname(binary), ...this.extraBinDirs, ...COMMON_BIN_DIRS, process.env.PATH ?? ""].join(":");
		return new Promise((resolve, reject) => {
			execFile(
				binary,
				[...args],
				{ signal, env: { ...process.env, PATH: path }, maxBuffer: 64 * 1024 * 1024 },
				(error, stdout, stderr) => {
					if (error) {
						const details = String(stderr).trim().split("\n").slice(-3).join(" ");
						reject(new Error(`${binary} завершился с ошибкой: ${details || error.message}`));
						return;
					}
					resolve(String(stdout));
				},
			);
		});
	}
}
