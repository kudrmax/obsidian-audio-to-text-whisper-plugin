import { spawn } from "child_process";
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
			if (!existsSync(path)) throw new Error(`executable not found: ${path}`);
			return path;
		}
		for (const dir of COMMON_BIN_DIRS) {
			for (const name of names) {
				const candidate = join(dir, name);
				if (existsSync(candidate)) return candidate;
			}
		}
		throw new Error(`${names.join(" / ")} not found: install it or set its path in the plugin settings`);
	}
}

export class ProcessRunner {
	constructor(private readonly extraBinDirs: readonly string[] = []) {}

	run(
		binary: string,
		args: readonly string[],
		signal: AbortSignal,
		onOutputLine: (line: string) => void = () => {},
	): Promise<string> {
		const path = [dirname(binary), ...this.extraBinDirs, ...COMMON_BIN_DIRS, process.env.PATH ?? ""].join(":");
		return new Promise((resolve, reject) => {
			const child = spawn(binary, [...args], { signal, env: { ...process.env, PATH: path }, stdio: ["ignore", "pipe", "pipe"] });
			let stdout = "";
			let stderrTail = "";
			const splitLines = (chunk: Buffer) => String(chunk).split(/[\r\n]+/).filter(Boolean).forEach(onOutputLine);

			child.stdout.on("data", (chunk: Buffer) => {
				stdout += String(chunk);
				splitLines(chunk);
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderrTail = (stderrTail + String(chunk)).slice(-2000);
				splitLines(chunk);
			});
			child.on("error", (error) => reject(error));
			child.on("close", (code) => {
				if (code === 0) {
					resolve(stdout);
					return;
				}
				const details = stderrTail.trim().split("\n").slice(-3).join(" ");
				reject(new Error(`${binary} exited with code ${code}: ${details}`));
			});
		});
	}
}
