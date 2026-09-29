import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ModelLocator } from "../src/infrastructure/transcribers/ModelLocator";

function dirWith(...files: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "models-"));
	files.forEach((f) => writeFileSync(join(dir, f), ""));
	return dir;
}

describe("ModelLocator", () => {
	const whisper = (dir: string) => new ModelLocator("whisper.cpp", [dir], ["ggml-large-v3-turbo.bin"], /^ggml-(?!silero).*\.bin$/);
	const vad = (dir: string) => new ModelLocator("VAD", [dir], ["ggml-silero-v5.1.2.bin"], /^ggml-silero-.*\.bin$/);

	it("never mistakes the VAD model for a Whisper model and vice versa", () => {
		const dir = dirWith("ggml-silero-v5.1.2.bin", "ggml-small.bin");

		expect(whisper(dir).locate("")).toBe(join(dir, "ggml-small.bin"));
		expect(vad(dir).locate("")).toBe(join(dir, "ggml-silero-v5.1.2.bin"));
	});

	it("prefers the preferred file", () => {
		const dir = dirWith("ggml-small.bin", "ggml-large-v3-turbo.bin");

		expect(whisper(dir).locate("")).toBe(join(dir, "ggml-large-v3-turbo.bin"));
	});

	it("fails with a clear message when nothing was downloaded", () => {
		expect(() => vad(dirWith()).locate("")).toThrow("download a model beforehand");
	});
});
