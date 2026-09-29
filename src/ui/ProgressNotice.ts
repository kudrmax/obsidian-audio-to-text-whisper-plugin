import { Notice } from "obsidian";
import { JobReport, ProgressListener, TranscriptionTask } from "../domain/ports";

export class ProgressNotice implements ProgressListener {
	private notice?: Notice;
	private startedAt = 0;
	private failed = 0;

	constructor(private readonly statusBar: HTMLElement) {}

	onStart(total: number): void {
		this.startedAt = Date.now();
		this.failed = 0;
		if (total === 0) return;
		this.notice = new Notice(`Whisper: найдено аудио — ${total}`, 0);
		this.statusBar.setText(`Whisper: 0/${total}`);
	}

	onTaskStart(index: number, total: number, task: TranscriptionTask): void {
		const name = task.embed.audioPath.split("/").pop();
		const lines = [
			`Whisper: ${index}/${total} готово${this.failed ? `, ошибок: ${this.failed}` : ""}`,
			`Сейчас: ${name}`,
			this.eta(index, total),
		].filter(Boolean);
		this.notice?.setMessage(lines.join("\n"));
		this.statusBar.setText(`Whisper: ${index}/${total}`);
	}

	onTaskEnd(_index: number, _total: number, task: TranscriptionTask, error?: string): void {
		if (!error) return;
		this.failed++;
		console.error(`[whisper-transcriber] ${task.notePath} → ${task.embed.audioPath}: ${error}`);
	}

	onFinish(report: JobReport): void {
		this.notice?.hide();
		this.statusBar.setText("");
		new Notice(ProgressNotice.summary(report), report.failures.length ? 0 : 8000);
	}

	private eta(done: number, total: number): string {
		if (done === 0) return "";
		const perTask = (Date.now() - this.startedAt) / done;
		const minutes = Math.ceil((perTask * (total - done)) / 60000);
		return `Осталось ≈ ${minutes} мин`;
	}

	private static summary(report: JobReport): string {
		if (report.total === 0 && report.recoveredDeletions === 0) return "Whisper: нечего распознавать";
		const lines = [`Whisper: распознано ${report.done} из ${report.total}${report.cancelled ? " (остановлено)" : ""}`];
		if (report.recoveredDeletions) lines.push(`Досписано в корзину после прошлого прерывания: ${report.recoveredDeletions}`);
		for (const failure of report.failures) {
			lines.push(`✗ ${failure.task.embed.audioPath}: ${failure.message}`);
		}
		return lines.join("\n");
	}
}
