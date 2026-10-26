export type WhisperEngine = "whisper.cpp" | "openai-whisper";

export interface TranscriberSettings {
	transcribeTagged: boolean;
	folder: string;
	tags: string[];
	removeTagsAfter: boolean;
	transcribeDailyNotes: boolean;
	/** YYYY-MM-DD; daily notes on or after this day are transcribed whole. */
	dailyNotesFrom: string;
	engine: WhisperEngine;
	whisperPath: string;
	ffmpegPath: string;
	model: string;
	vadModel: string;
	language: string;
}

export const DEFAULT_SETTINGS: TranscriberSettings = {
	transcribeTagged: true,
	folder: "",
	tags: ["transcribe"],
	removeTagsAfter: true,
	transcribeDailyNotes: false,
	dailyNotesFrom: "",
	engine: "whisper.cpp",
	whisperPath: "",
	ffmpegPath: "",
	model: "",
	vadModel: "",
	language: "ru",
};
