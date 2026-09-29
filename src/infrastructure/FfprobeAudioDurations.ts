import { existsSync } from "fs";
import { dirname, join } from "path";
import { AudioDurations } from "../domain/ports";
import { BinaryLocator, ProcessRunner, expandHome } from "./transcribers/ProcessRunner";

/** Durations only feed the time estimate, so any failure yields "unknown" instead of an error. */
export class FfprobeAudioDurations implements AudioDurations {
	constructor(private readonly ffmpegPath: string) {}

	async secondsOf(absoluteAudioPath: string): Promise<number | undefined> {
		try {
			const output = await new ProcessRunner().run(
				this.ffprobe(),
				["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", absoluteAudioPath],
				new AbortController().signal,
			);
			const seconds = Number.parseFloat(output.trim());
			return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
		} catch {
			return undefined;
		}
	}

	private ffprobe(): string {
		if (this.ffmpegPath.trim()) {
			const sibling = join(dirname(expandHome(this.ffmpegPath.trim())), "ffprobe");
			if (existsSync(sibling)) return sibling;
		}
		return BinaryLocator.locate("", ["ffprobe"]);
	}
}
