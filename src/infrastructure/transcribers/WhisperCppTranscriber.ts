import { homedir } from "os";
import { join } from "path";
import { Transcriber } from "../../domain/ports";
import { TranscriberSettings } from "../../settings";
import { ModelLocator } from "./ModelLocator";
import { BinaryLocator, ProcessRunner } from "./ProcessRunner";
import { TempWorkspace } from "./TempWorkspace";

const PROGRESS_LINE = /progress\s*=\s*(\d+)%/;

export class WhisperCppTranscriber implements Transcriber {
	static readonly models = new ModelLocator(
		"whisper.cpp",
		[
			join(homedir(), "whisper-models"),
			join(homedir(), ".cache/whisper.cpp"),
			"/opt/homebrew/share/whisper-cpp",
			"/usr/local/share/whisper-cpp",
		],
		["ggml-large-v3-turbo.bin", "ggml-large-v3.bin", "ggml-medium.bin", "ggml-small.bin"],
		/^ggml-.*\.bin$/,
	);

	constructor(private readonly settings: TranscriberSettings) {}

	async transcribe(absoluteAudioPath: string, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<string> {
		const whisper = BinaryLocator.locate(this.settings.whisperPath, ["whisper-cli", "whisper-cpp"]);
		const ffmpeg = BinaryLocator.locate(this.settings.ffmpegPath, ["ffmpeg"]);
		const model = WhisperCppTranscriber.models.locate(this.settings.model);
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
				["-m", model, "-f", wav, "-l", this.settings.language || "auto", "-otxt", "-of", workspace.path("out"), "-np", "-pp"],
				signal,
				(line) => {
					const match = PROGRESS_LINE.exec(line);
					if (match) onProgress(Number(match[1]) / 100);
				},
			);
			return workspace.readText("out.txt");
		});
	}
}
