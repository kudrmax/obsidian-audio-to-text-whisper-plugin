export function formatDuration(totalSeconds: number): string {
	const seconds = Math.max(0, Math.round(totalSeconds));
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	if (h > 0) return `${h} h ${m} min`;
	if (m > 0) return `${m} min ${s} s`;
	return `${s} s`;
}
