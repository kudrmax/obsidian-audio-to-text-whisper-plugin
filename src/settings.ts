import { TranscriptionRule } from "./domain/TranscriptionRule";

export type WhisperEngine = "whisper.cpp" | "openai-whisper";

export interface TranscriberSettings {
	/** Rules combine with OR: audio matching any of them is transcribed. Empty until the user adds one. */
	rules: TranscriptionRule[];
	engine: WhisperEngine;
	whisperPath: string;
	ffmpegPath: string;
	model: string;
	vadModel: string;
	language: string;
}

export const NEW_RULE: TranscriptionRule = {
	scope: "folders",
	folders: [""],
	fromDate: "",
	onlyTagged: true,
	tags: ["transcribe"],
	removeTagsAfter: true,
};

export const DEFAULT_SETTINGS: Readonly<TranscriberSettings> = {
	rules: [],
	engine: "whisper.cpp",
	whisperPath: "",
	ffmpegPath: "",
	model: "",
	vadModel: "",
	language: "ru",
};
