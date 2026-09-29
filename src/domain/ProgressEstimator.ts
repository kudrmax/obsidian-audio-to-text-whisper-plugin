interface CurrentTask {
	readonly index: number;
	readonly startedAt: number;
	fraction: number;
}

/**
 * Estimates the remaining time from audio durations and the transcription speed,
 * measured as processing seconds per second of audio (model loading included).
 */
export class ProgressEstimator {
	private readonly durations: readonly number[];
	private readonly finished = new Set<number>();
	private current?: CurrentTask;
	private measuredProcessing = 0;
	private measuredAudio = 0;

	constructor(
		durations: readonly (number | undefined)[],
		private readonly knownSpeed?: number,
	) {
		const known = durations.filter((d): d is number => d !== undefined && d > 0);
		const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;
		this.durations = durations.map((d) => d ?? fallback);
	}

	get totalAudioSeconds(): number {
		return this.durations.reduce((a, b) => a + b, 0);
	}

	get measuredSpeed(): number | undefined {
		return this.measuredAudio > 0 ? this.measuredProcessing / this.measuredAudio : undefined;
	}

	start(index: number, now: number): void {
		this.current = { index, startedAt: now, fraction: 0 };
	}

	progress(index: number, fraction: number): void {
		if (this.current?.index === index) this.current.fraction = Math.min(Math.max(fraction, 0), 1);
	}

	finish(index: number, now: number, succeeded: boolean): void {
		const duration = this.durations[index];
		if (succeeded && this.current?.index === index && duration > 0) {
			this.measuredProcessing += (now - this.current.startedAt) / 1000;
			this.measuredAudio += duration;
		}
		this.finished.add(index);
		if (this.current?.index === index) this.current = undefined;
	}

	/** Share of the total audio already processed, from 0 to 1. */
	fraction(): number {
		const total = this.totalAudioSeconds;
		if (total === 0) return this.durations.length === 0 ? 1 : this.finished.size / this.durations.length;
		return (this.totalAudioSeconds - this.remainingAudioSeconds()) / total;
	}

	remainingSeconds(now: number): number | undefined {
		const speed = this.measuredSpeed ?? this.knownSpeed ?? this.currentTaskSpeed(now);
		if (speed === undefined) return undefined;
		return this.remainingAudioSeconds() * speed;
	}

	private remainingAudioSeconds(): number {
		return this.durations.reduce((sum, duration, index) => {
			if (this.finished.has(index)) return sum;
			const done = this.current?.index === index ? this.current.fraction : 0;
			return sum + duration * (1 - done);
		}, 0);
	}

	private currentTaskSpeed(now: number): number | undefined {
		if (!this.current || this.current.fraction <= 0) return undefined;
		const duration = this.durations[this.current.index];
		if (!duration) return undefined;
		return (now - this.current.startedAt) / 1000 / (duration * this.current.fraction);
	}
}
