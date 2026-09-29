import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Transcriber } from "../../domain/ports";
import { TranscriberSettings } from "../../settings";
import { BinaryLocator, ProcessRunner, expandHome } from "./ProcessRunner";
import { TempWorkspace } from "./TempWorkspace";

const MODEL_DIRS = [
	join(homedir(), "whisper-models"),
	join(homedir(), ".cache/whisper.cpp"),
	join(homedir(), ".cache/whisper"),
	"/opt/homebrew/share/whisper-cpp",
	"/usr/local/share/whisper-cpp",
];
const PREFERRED_MODELS = ["ggml-large-v3-turbo.bin", "ggml-large-v3.bin", "ggml-medium.bin", "ggml-small.bin"];

export class WhisperCppTranscriber implements Transcriber {
	constructor(private readonly settings: TranscriberSettings) {}

	async transcribe(absoluteAudioPath: string, signal: AbortSignal): Promise<string> {
		const whisper = BinaryLocator.locate(this.settings.whisperPath, ["whisper-cli", "whisper-cpp"]);
		const ffmpeg = BinaryLocator.locate(this.settings.ffmpegPath, ["ffmpeg"]);
		const model = WhisperCppTranscriber.locateModel(this.settings.model);
		const runner = new ProcessRunner();

		return TempWorkspace.use(async (workspace) => {
			const wav = workspace.path("input.wav");
			await runner.run(
				ffmpeg,
				["-nostdin", "-y", "-i", absoluteAudioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
				signal,
			);
			await runner.run(
				whisper,
				["-m", model, "-f", wav, "-l", this.settings.language || "auto", "-otxt", "-of", workspace.path("out"), "-np"],
				signal,
			);
			return workspace.readText("out.txt");
		});
	}

	static locateModel(configured: string): string {
		if (configured.trim()) {
			const path = expandHome(configured.trim());
			if (!existsSync(path)) throw new Error(`не найдена модель whisper.cpp: ${path}`);
			return path;
		}
		for (const dir of MODEL_DIRS.filter((d) => existsSync(d))) {
			const files = readdirSync(dir).filter((f) => /^ggml-.*\.bin$/.test(f));
			const best = PREFERRED_MODELS.find((m) => files.includes(m)) ?? files[0];
			if (best) return join(dir, best);
		}
		throw new Error("не найдена модель whisper.cpp: скачайте ggml-модель в ~/whisper-models или укажите путь в настройках");
	}
}
