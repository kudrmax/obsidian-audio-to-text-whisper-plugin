import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export class TempWorkspace {
	private constructor(readonly dir: string) {}

	static async use<T>(action: (workspace: TempWorkspace) => Promise<T>): Promise<T> {
		const workspace = new TempWorkspace(await mkdtemp(join(tmpdir(), "obsidian-whisper-")));
		try {
			return await action(workspace);
		} finally {
			await rm(workspace.dir, { recursive: true, force: true });
		}
	}

	path(name: string): string {
		return join(this.dir, name);
	}

	async readText(name: string): Promise<string> {
		return normalizeTranscript(await readFile(this.path(name), "utf8"));
	}
}

export function normalizeTranscript(raw: string): string {
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join(" ");
}
