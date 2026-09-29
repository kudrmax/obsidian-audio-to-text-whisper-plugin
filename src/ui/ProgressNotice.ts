import { Notice } from "obsidian";
import { ProgressEstimator } from "../domain/ProgressEstimator";
import { JobReport, ProgressListener, TranscriptionTask } from "../domain/ports";
import { formatDuration } from "./formatDuration";

const TITLE = "Audio to Text";

export class ProgressNotice implements ProgressListener {
	private notice?: Notice;
	private timer?: number;
	private estimator = new ProgressEstimator([]);
	private tasks: readonly TranscriptionTask[] = [];
	private currentIndex = 0;
	private completed = 0;
	private failed = 0;

	constructor(
		private readonly statusBar: HTMLElement,
		private readonly knownSpeed: number | undefined,
		private readonly onSpeedMeasured: (speed: number) => void,
	) {}

	onStart(tasks: readonly TranscriptionTask[]): void {
		this.tasks = tasks;
		this.estimator = new ProgressEstimator(
			tasks.map((t) => t.durationSeconds),
			this.knownSpeed,
		);
		if (tasks.length === 0) return;
		this.notice = new Notice("", 0);
		this.timer = window.setInterval(() => this.render(), 1000);
		this.render();
	}

	onTaskStart(index: number): void {
		this.currentIndex = index;
		this.estimator.start(index, Date.now());
		this.render();
	}

	onTaskProgress(index: number, fraction: number): void {
		this.estimator.progress(index, fraction);
		this.render();
	}

	onTaskEnd(index: number, task: TranscriptionTask, error?: string): void {
		this.estimator.finish(index, Date.now(), !error);
		this.completed++;
		if (error) {
			this.failed++;
			console.error(`[audio-to-text-whisper] ${task.notePath} → ${task.embed.audioPath}: ${error}`);
		}
		this.render();
	}

	onFinish(report: JobReport): void {
		window.clearInterval(this.timer);
		this.notice?.hide();
		this.statusBar.setText("");
		const speed = this.estimator.measuredSpeed;
		if (speed !== undefined) this.onSpeedMeasured(speed);
		new Notice(ProgressNotice.summary(report), report.failures.length ? 0 : 8000);
	}

	private render(): void {
		if (!this.notice) return;
		const total = this.tasks.length;
		const percent = Math.floor(this.estimator.fraction() * 100);
		const task = this.tasks[this.currentIndex];
		const name = task?.embed.audioPath.split("/").pop() ?? "";
		const length = task?.durationSeconds ? ` (${formatDuration(task.durationSeconds)})` : "";
		const lines = [
			`${TITLE}: ${this.completed}/${total} done · ${percent}%${this.failed ? ` · ${this.failed} failed` : ""}`,
			`Now: ${name}${length}`,
			this.etaLine(),
		];
		this.notice.setMessage(lines.join("\n"));
		this.statusBar.setText(`${TITLE}: ${this.completed}/${total} · ${percent}%`);
	}

	private etaLine(): string {
		const now = Date.now();
		const remaining = this.estimator.remainingSeconds(now);
		if (remaining === undefined) {
			return `Estimating time… (${formatDuration(this.estimator.totalAudioSeconds)} of audio in total)`;
		}
		const finishAt = new Date(now + remaining * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		return `≈ ${formatDuration(remaining)} left · done at ${finishAt}`;
	}

	private static summary(report: JobReport): string {
		if (report.total === 0 && report.recoveredDeletions === 0) return `${TITLE}: nothing to transcribe`;
		const lines = [`${TITLE}: transcribed ${report.done} of ${report.total}${report.cancelled ? " (stopped)" : ""}`];
		if (report.recoveredDeletions) {
			lines.push(`Moved to trash after the previous interrupted run: ${report.recoveredDeletions}`);
		}
		for (const failure of report.failures) {
			lines.push(`✗ ${failure.task.embed.audioPath}: ${failure.message}`);
		}
		return lines.join("\n");
	}
}
