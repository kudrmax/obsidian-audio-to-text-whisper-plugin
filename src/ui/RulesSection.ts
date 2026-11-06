import { App, Setting, setIcon } from "obsidian";
import { RuleScope, TranscriptionRule, ValidRule } from "../domain/TranscriptionRule";
import { dailyNotesConfig } from "../infrastructure/ObsidianDailyNotes";
import { PluginStore } from "../infrastructure/PluginStore";
import { NEW_RULE } from "../settings";
import { FolderSuggest } from "./FolderSuggest";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RuleUpdate = (patch: (rule: TranscriptionRule) => Partial<TranscriptionRule>, redraw?: boolean) => Promise<void>;

/** The list of rules: a card per rule, OR between cards. */
export class RulesSection {
	private saving = false;

	constructor(
		private readonly app: App,
		private readonly store: PluginStore,
		private readonly redraw: () => void,
	) {}

	display(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("What to transcribe")
			.setDesc("Audio is transcribed when it matches any rule. Inside a rule, every condition must hold.")
			.setHeading();

		const rules = this.rules();
		if (rules.length === 0) {
			containerEl.createDiv({
				cls: "att-rules-empty",
				text: "No rules yet, so Transcribe audio does nothing. Transcribe audio in current note still works.",
			});
		}
		rules.forEach((_, index) => {
			if (index > 0) containerEl.createDiv({ cls: "att-rule-or", text: "or" });
			this.displayRule(containerEl.createDiv({ cls: "att-rule" }), index);
		});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText("Add rule")
				.setCta()
				.onClick(() => this.saveRules([...this.rules(), structuredClone(NEW_RULE)], true)),
		);
	}

	private displayRule(cardEl: HTMLElement, index: number): void {
		const rule = this.rules()[index];
		const header = new Setting(cardEl)
			.setName(`Rule ${index + 1}`)
			.addExtraButton((button) =>
				button
					.setIcon("trash-2")
					.setTooltip("Delete rule")
					.onClick(() => this.saveRules(this.rules().filter((_, i) => i !== index), true)),
			);
		header.settingEl.addClass("att-rule-header");
		if (!RulesSection.isEditable(rule)) {
			RulesSection.warn(header.descEl, "This rule is damaged. Delete it and add it again.");
			return;
		}
		const describe = (current: TranscriptionRule) => {
			header.descEl.empty();
			const problem = RulesSection.problemOf(current, index);
			if (problem) RulesSection.warn(header.descEl, problem);
			else this.renderSummary(header.descEl, current);
		};
		describe(rule);

		const update: RuleUpdate = async (patch, redraw = false) => {
			const current = this.rules()[index];
			const updated = { ...current, ...patch(current) };
			describe(updated);
			await this.saveRules(this.rules().map((r, i) => (i === index ? updated : r)), redraw);
		};

		new Setting(cardEl).setName("Where").addDropdown((dropdown) =>
			dropdown
				.addOption("folders", "Folders")
				.addOption("daily", "Daily notes")
				.setValue(rule.scope)
				.onChange((value) =>
					update((current) => ({
						scope: value as RuleScope,
						folders: value === "folders" && current.folders.length === 0 ? [""] : current.folders,
					}), true),
				),
		);
		if (rule.scope === "folders") this.displayFolders(cardEl, rule, update);
		if (rule.scope === "daily") this.displayDates(cardEl, rule, update);

		new Setting(cardEl).setName("Which audio").addDropdown((dropdown) =>
			dropdown
				.addOption("all", "Every audio")
				.addOption("tagged", "Only with a tag on its line")
				.setValue(rule.onlyTagged ? "tagged" : "all")
				.onChange((value) => update(() => ({ onlyTagged: value === "tagged" }), true)),
		);
		if (rule.onlyTagged) this.displayTags(cardEl, rule, update);
	}

	private displayFolders(cardEl: HTMLElement, rule: TranscriptionRule, update: RuleUpdate): void {
		const hint = "Including subfolders. / is the whole vault.";
		rule.folders.forEach((folder, folderIndex) => {
			const setting = new Setting(cardEl).setName(folderIndex === 0 ? "Folders" : "");
			setting.settingEl.addClass("att-rule-list-item");
			const describe = (value: string) => {
				const missing = this.missingFolder(value);
				setting.setDesc(folderIndex === 0 && !missing ? hint : "");
				if (missing) RulesSection.warn(setting.descEl, `Folder "${missing}" not found.`);
			};
			describe(folder);
			setting.addText((text) => {
				new FolderSuggest(this.app, text.inputEl);
				text
					.setPlaceholder("Journal")
					.setValue(folder)
					.onChange((value) => {
						describe(value);
						void update((current) => ({ folders: current.folders.map((f, i) => (i === folderIndex ? value.trim() : f)) }));
					});
			});
			if (rule.folders.length > 1) {
				setting.addExtraButton((button) =>
					button
						.setIcon("x")
						.setTooltip("Remove folder")
						.onClick(() => update((current) => ({ folders: current.folders.filter((_, i) => i !== folderIndex) }), true)),
				);
			}
		});
		new Setting(cardEl).addButton((button) =>
			button.setButtonText("Add folder").onClick(() => update((current) => ({ folders: [...current.folders, ""] }), true)),
		);
	}

	private displayDates(cardEl: HTMLElement, rule: TranscriptionRule, update: RuleUpdate): void {
		const config = dailyNotesConfig(this.app);
		const setting = new Setting(cardEl).setName("Dates");
		if (config) setting.setDesc(`Notes named ${config.format} in "${config.folder || "/"}", as set in Obsidian's Daily notes plugin.`);
		else RulesSection.warn(setting.descEl, "Enable the Daily notes core plugin in Obsidian first.");
		setting.addDropdown((dropdown) =>
			dropdown
				.addOption("any", "Any date")
				.addOption("from", "From a date")
				.setValue(rule.fromDate ? "from" : "any")
				.onChange((value) => update(() => ({ fromDate: value === "from" ? RulesSection.today() : "" }), true)),
		);
		if (rule.fromDate) {
			setting.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(rule.fromDate).onChange((value) => {
					if (ISO_DATE.test(value)) void update(() => ({ fromDate: value }));
				});
			});
		}
	}

	private displayTags(cardEl: HTMLElement, rule: TranscriptionRule, update: RuleUpdate): void {
		new Setting(cardEl)
			.setName("Tags")
			.setDesc("One per line, without #. Any of them on the audio's line will do.")
			.addTextArea((text) =>
				text
					.setPlaceholder("transcribe")
					.setValue(rule.tags.join("\n"))
					.onChange((value) =>
						update(() => ({ tags: value.split("\n").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) })),
					),
			);
		new Setting(cardEl)
			.setName("Remove tag after transcription")
			.addToggle((toggle) => toggle.setValue(rule.removeTagsAfter).onChange((value) => update(() => ({ removeTagsAfter: value }))));
	}

	/** Every fact of the rule as its own chip; broad rules get a warning under them. */
	private renderSummary(el: HTMLElement, rule: TranscriptionRule): void {
		const chips = el.createDiv({ cls: "att-chips" });
		const chip = (icon: string, text: string) => {
			const chipEl = chips.createSpan({ cls: "att-chip" });
			setIcon(chipEl.createSpan({ cls: "att-chip-icon" }), icon);
			chipEl.createSpan({ text });
		};
		const wholeVault = rule.scope === "folders" && rule.folders.some((f) => f.trim() !== "" && f.replace(/[\s/]/g, "") === "");
		if (rule.scope === "daily") chip("calendar", rule.fromDate ? `Daily notes from ${rule.fromDate}` : "Every daily note");
		else if (wholeVault) chip("vault", "Whole vault");
		else for (const folder of rule.folders.map((f) => f.trim()).filter(Boolean)) chip("folder", folder);
		if (rule.onlyTagged) for (const tag of rule.tags) chip("tag", tag);
		else chip("audio-lines", "Every audio");

		if (!rule.onlyTagged && (wholeVault || (rule.scope === "daily" && !rule.fromDate))) {
			RulesSection.warn(el, wholeVault ? "Every audio in the vault will be replaced with text and trashed." : "Every audio in every daily note will be replaced with text and trashed.");
		}
	}

	private missingFolder(value: string): string | undefined {
		const folder = value.normalize("NFC").trim().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
		if (!folder) return undefined;
		const exists = this.app.vault.getAllFolders().some((f) => f.path.normalize("NFC") === folder);
		return exists ? undefined : value.trim();
	}

	private rules(): TranscriptionRule[] {
		return this.store.settings.rules;
	}

	/** Structural changes ignore clicks until the redraw, so a double click never hits the next rule by position. */
	private async saveRules(rules: TranscriptionRule[], redraw: boolean): Promise<void> {
		if (this.saving) return;
		if (redraw) this.saving = true;
		await this.store.updateSettings({ rules });
		if (redraw) this.redraw();
	}

	private static isEditable(rule: unknown): rule is TranscriptionRule {
		if (typeof rule !== "object" || rule === null) return false;
		const r = rule as Record<string, unknown>;
		return (r.scope === "folders" || r.scope === "daily") && Array.isArray(r.folders) && Array.isArray(r.tags);
	}

	private static warn(el: HTMLElement, text: string): void {
		const line = el.createDiv({ cls: "att-warning" });
		setIcon(line.createSpan({ cls: "att-warning-icon" }), "alert-triangle");
		line.createSpan({ text });
	}

	private static problemOf(rule: TranscriptionRule, index: number): string | undefined {
		try {
			ValidRule.parse(rule, index + 1);
			return undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return message.replace(/^rule \d+: /, "").replace(/^./, (c) => c.toUpperCase()) + ".";
		}
	}

	private static today(): string {
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	}
}
