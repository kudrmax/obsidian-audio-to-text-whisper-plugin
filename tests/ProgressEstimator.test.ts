import { describe, expect, it } from "vitest";
import { ProgressEstimator } from "../src/domain/ProgressEstimator";
import { formatDuration } from "../src/ui/formatDuration";

describe("ProgressEstimator", () => {
	it("has no estimate before any speed is known", () => {
		const estimator = new ProgressEstimator([60, 60]);
		estimator.start(0, 0);

		expect(estimator.remainingSeconds(1000)).toBeUndefined();
		expect(estimator.totalAudioSeconds).toBe(120);
	});

	it("uses the speed remembered from previous runs right away", () => {
		const estimator = new ProgressEstimator([60, 60], 0.5);

		expect(estimator.remainingSeconds(0)).toBe(60);
	});

	it("derives speed from the current file progress", () => {
		const estimator = new ProgressEstimator([100, 100]);
		estimator.start(0, 0);
		estimator.progress(0, 0.5);

		expect(estimator.remainingSeconds(10_000)).toBeCloseTo(30);
		expect(estimator.fraction()).toBeCloseTo(0.25);
	});

	it("prefers the speed measured in this run over the remembered one", () => {
		const estimator = new ProgressEstimator([100, 100], 10);
		estimator.start(0, 0);
		estimator.finish(0, 20_000, true);

		expect(estimator.measuredSpeed).toBeCloseTo(0.2);
		expect(estimator.remainingSeconds(20_000)).toBeCloseTo(20);
		expect(estimator.fraction()).toBeCloseTo(0.5);
	});

	it("ignores failed files when measuring speed", () => {
		const estimator = new ProgressEstimator([100, 100]);
		estimator.start(0, 0);
		estimator.finish(0, 1_000, false);

		expect(estimator.measuredSpeed).toBeUndefined();
	});

	it("substitutes unknown durations with the average of known ones", () => {
		const estimator = new ProgressEstimator([30, undefined, 90], 1);

		expect(estimator.totalAudioSeconds).toBe(180);
	});
});

describe("formatDuration", () => {
	it("formats seconds, minutes and hours", () => {
		expect(formatDuration(42.4)).toBe("42 s");
		expect(formatDuration(80)).toBe("1 min 20 s");
		expect(formatDuration(3_900)).toBe("1 h 5 min");
	});
});
