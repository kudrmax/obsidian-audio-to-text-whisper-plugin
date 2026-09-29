import { homedir } from "os";
import { dirname, join, parse } from "path";
import { Transcriber } from "../../domain/ports";
import { TranscriberSettings } from "../../settings";
import { ModelLocator } from "./ModelLocator";
import { BinaryLocator, ProcessRunner } from "./ProcessRunner";
import { TempWorkspace } from "./TempWorkspace";

const TQDM_PROGRESS = /(\d+)%\|/;

export class OpenAIWhisperTranscriber implements Transcriber {
	static readonly models = new ModelLocator(
		"openai-whisper",
		[join(homedir(), ".cache/whisper"), join(homedir(), "whisper-models")],
		["large-v3-turbo.pt", "large-v3.pt", "medium.pt", "small.pt"],
		/\.pt$/,
	);

	constructor(private readonly settings: TranscriberSettings) {}

	async transcribe(absoluteAudioPath: string, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<string> {
		const whisper = BinaryLocator.locate(this.settings.whisperPath, ["whisper"]);
		const ffmpeg = BinaryLocator.locate(this.settings.ffmpegPath, ["ffmpeg"]);
		// A file path, unlike a model name, keeps openai-whisper from downloading anything.
		const model = OpenAIWhisperTranscriber.models.locate(this.settings.model);
		const runner = new ProcessRunner([dirname(ffmpeg)]);
		const language = this.settings.language && this.settings.language !== "auto" ? ["--language", this.settings.language] : [];

		return TempWorkspace.use(async (workspace) => {
			await runner.run(
				whisper,
				[
					absoluteAudioPath,
					"--model", model,
					"--output_format", "txt",
					"--output_dir", workspace.dir,
					"--verbose", "False",
					...language,
				],
				signal,
				(line) => {
					const match = TQDM_PROGRESS.exec(line);
					if (match) onProgress(Number(match[1]) / 100);
				},
			);
			return workspace.readText(`${parse(absoluteAudioPath).name}.txt`);
		});
	}
}
