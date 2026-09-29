export type WhisperEngine = "whisper.cpp" | "openai-whisper";

export interface TranscriberSettings {
	folder: string;
	tags: string[];
	removeTagsAfter: boolean;
	engine: WhisperEngine;
	whisperPath: string;
	ffmpegPath: string;
	model: string;
	language: string;
}

export const DEFAULT_SETTINGS: TranscriberSettings = {
	folder: "",
	tags: ["transcribe"],
	removeTagsAfter: true,
	engine: "whisper.cpp",
	whisperPath: "",
	ffmpegPath: "",
	model: "",
	language: "ru",
};
