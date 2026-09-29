import { dirname, parse } from "path";
import { Transcriber } from "../../domain/ports";
import { TranscriberSettings } from "../../settings";
import { BinaryLocator, ProcessRunner } from "./ProcessRunner";
import { TempWorkspace } from "./TempWorkspace";

export class OpenAIWhisperTranscriber implements Transcriber {
	constructor(private readonly settings: TranscriberSettings) {}

	async transcribe(absoluteAudioPath: string, signal: AbortSignal): Promise<string> {
		const whisper = BinaryLocator.locate(this.settings.whisperPath, ["whisper"]);
		const ffmpeg = BinaryLocator.locate(this.settings.ffmpegPath, ["ffmpeg"]);
		const runner = new ProcessRunner([dirname(ffmpeg)]);
		const language = this.settings.language && this.settings.language !== "auto" ? ["--language", this.settings.language] : [];

		return TempWorkspace.use(async (workspace) => {
			await runner.run(
				whisper,
				[
					absoluteAudioPath,
					"--model", this.settings.model.trim() || "turbo",
					"--output_format", "txt",
					"--output_dir", workspace.dir,
					"--verbose", "False",
					...language,
				],
				signal,
			);
			return workspace.readText(`${parse(absoluteAudioPath).name}.txt`);
		});
	}
}
