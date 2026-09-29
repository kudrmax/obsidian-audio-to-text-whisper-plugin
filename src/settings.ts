export type WhisperEngine = "whisper.cpp" | "openai-whisper";

export interface TranscriberSettings {
	folders: string[];
	tag: string;
	engine: WhisperEngine;
	whisperPath: string;
	ffmpegPath: string;
	model: string;
	language: string;
}

export const DEFAULT_SETTINGS: TranscriberSettings = {
	folders: [],
	tag: "transcribe",
	engine: "whisper.cpp",
	whisperPath: "",
	ffmpegPath: "",
	model: "",
	language: "ru",
};
