import { Transcriber } from "../../domain/ports";
import { TranscriberSettings } from "../../settings";
import { OpenAIWhisperTranscriber } from "./OpenAIWhisperTranscriber";
import { WhisperCppTranscriber } from "./WhisperCppTranscriber";

export class TranscriberFactory {
	static create(settings: TranscriberSettings): Transcriber {
		switch (settings.engine) {
			case "openai-whisper":
				return new OpenAIWhisperTranscriber(settings);
			case "whisper.cpp":
				return new WhisperCppTranscriber(settings);
		}
	}
}
