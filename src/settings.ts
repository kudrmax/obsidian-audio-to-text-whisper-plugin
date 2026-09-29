export type WhisperEngine = "whisper.cpp" | "openai-whisper";

export interface TranscriberSettings {
	folders: string[];
	tags: string[];
	engine: WhisperEngine;
	whisperPath: string;
	ffmpegPath: string;
	model: string;
	language: string;
}

export const DEFAULT_SETTINGS: TranscriberSettings = {
	folders: [],
	tags: [],
	engine: "whisper.cpp",
	whisperPath: "",
	ffmpegPath: "",
	model: "",
	language: "ru",
};
