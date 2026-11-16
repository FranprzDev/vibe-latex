import { App, Modal } from "obsidian";
import {
	createFeedbackReport,
	serializeFeedback,
	type FeedbackContext,
	type FeedbackReport,
} from "./feedback";

export interface FeedbackModalOptions {
	version: string;
	context?: FeedbackContext;
	diagnose: (report: FeedbackReport, signal: AbortSignal) => Promise<string>;
	dictate: (signal: AbortSignal) => Promise<string>;
	save: (report: FeedbackReport) => Promise<string>;
}

export class FeedbackModal extends Modal {
	private readonly options: FeedbackModalOptions;
	private busy = false;
	private abortController: AbortController | null = null;
	private includeContext = false;
	private report: FeedbackReport | null = null;
	private saved = false;
	private savedPath: string | null = null;

	private descEl: HTMLTextAreaElement | null = null;
	private includeCb: HTMLInputElement | null = null;
	private contextDetailsEl: HTMLElement | null = null;
	private contextPreviewEl: HTMLTextAreaElement | null = null;
	private previewEl: HTMLTextAreaElement | null = null;
	private statusEl: HTMLElement | null = null;
	private savedPathEl: HTMLElement | null = null;
	private warningEl: HTMLElement | null = null;

	private dictateBtn: HTMLButtonElement | null = null;
	private prepareBtn: HTMLButtonElement | null = null;
	private diagnoseBtn: HTMLButtonElement | null = null;
	private saveBtn: HTMLButtonElement | null = null;
	private copyBtn: HTMLButtonElement | null = null;
	private cancelBtn: HTMLButtonElement | null = null;

	constructor(app: App, options: FeedbackModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty?.();
		this.setTitle?.("Reportar un problema");

		contentEl.createEl("p", { text: "Descripción del problema" });
		const desc = contentEl.createEl("textarea");
		this.descEl = desc as HTMLTextAreaElement;
		if (this.descEl) {
			this.descEl.rows = 6;
			this.descEl.cols = 60;
			this.descEl.style.width = "100%";
			this.descEl.placeholder = "Describí qué pasó...";
			this.descEl.oninput = () => {
				if (this.busy) return;
				this.invalidatePrepared();
			};
		}

		const dictateRow = contentEl.createEl("div");
		this.dictateBtn = dictateRow.createEl("button", { text: "Dictar reporte" }) as HTMLButtonElement;
		if (this.dictateBtn) this.dictateBtn.onclick = () => void this.handleDictate();

		const includeRow = contentEl.createEl("div");
		const includeLabel = includeRow.createEl("label");
		const cb = includeLabel.createEl("input", { type: "checkbox" });
		this.includeCb = cb as HTMLInputElement;
		if (this.includeCb) {
			this.includeCb.checked = false;
			this.includeCb.onchange = () => {
				this.includeContext = !!this.includeCb?.checked;
				this.refreshContextPreview();
				if (!this.busy) this.invalidatePrepared();
			};
		}
		includeLabel.createEl("span", {
			text: " Incluir última entrada/salida (privacidad: los archivos locales pueden sincronizarse con la bóveda y nada se envía automáticamente)",
		});

		const details = contentEl.createEl("details");
		this.contextDetailsEl = details;
		details.createEl("summary", { text: "Contexto (última entrada/salida)" });
		const ctxPreview = details.createEl("textarea");
		this.contextPreviewEl = ctxPreview as HTMLTextAreaElement;
		if (this.contextPreviewEl) {
			this.contextPreviewEl.readOnly = true;
			this.contextPreviewEl.rows = 6;
			this.contextPreviewEl.style.width = "100%";
		}
		this.refreshContextPreview();

		const actions = contentEl.createEl("div");
		this.prepareBtn = actions.createEl("button", { text: "Preparar reporte" }) as HTMLButtonElement;
		if (this.prepareBtn) this.prepareBtn.onclick = () => void this.handlePrepare();

		this.diagnoseBtn = actions.createEl("button", { text: "Diagnosticar con Qwen local" }) as HTMLButtonElement;
		if (this.diagnoseBtn) this.diagnoseBtn.onclick = () => void this.handleDiagnose();

		this.saveBtn = actions.createEl("button", { text: "Guardar reporte local" }) as HTMLButtonElement;
		if (this.saveBtn) this.saveBtn.onclick = () => void this.handleSave();

		this.copyBtn = actions.createEl("button", { text: "Copiar para compartir" }) as HTMLButtonElement;
		if (this.copyBtn) this.copyBtn.onclick = () => void this.handleCopy();

		this.cancelBtn = actions.createEl("button", { text: "Cancelar" }) as HTMLButtonElement;
		if (this.cancelBtn) this.cancelBtn.onclick = () => this.handleCancel();

		this.warningEl = contentEl.createEl("p");
		if (this.warningEl) {
			this.warningEl.style.color = "var(--text-warning)";
			this.warningEl.setText("Hipótesis local: no modifica código ni entrena modelos.");
		}

		contentEl.createEl("p", { text: "Vista previa del reporte (solo lectura)" });
		const preview = contentEl.createEl("textarea");
		this.previewEl = preview as HTMLTextAreaElement;
		if (this.previewEl) {
			this.previewEl.readOnly = true;
			this.previewEl.rows = 12;
			this.previewEl.style.width = "100%";
		}

		this.savedPathEl = contentEl.createEl("p");
		this.statusEl = contentEl.createEl("p");

		this.updateControls();
	}

	onClose(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.contentEl.empty?.();
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.updateControls();
	}

	private updateControls(): void {
		const hasReport = !!this.report;
		if (this.dictateBtn) this.dictateBtn.disabled = this.busy;
		if (this.prepareBtn) this.prepareBtn.disabled = this.busy;
		if (this.diagnoseBtn) this.diagnoseBtn.disabled = this.busy || !hasReport || this.saved;
		if (this.saveBtn) this.saveBtn.disabled = this.busy || !hasReport || this.saved;
		if (this.copyBtn) this.copyBtn.disabled = this.busy || !hasReport;
		if (this.cancelBtn) this.cancelBtn.disabled = !this.busy;
		if (this.descEl) this.descEl.disabled = this.busy;
		if (this.includeCb) this.includeCb.disabled = this.busy;
	}

	private invalidatePrepared(): void {
		this.report = null;
		this.saved = false;
		this.savedPath = null;
		if (this.savedPathEl) this.savedPathEl.setText("");
		if (this.previewEl) this.previewEl.value = "";
		this.updateControls();
	}

	private refreshContextPreview(): void {
		const ctx = this.options.context;
		let text = "";
		if (this.includeContext && ctx) {
			const parts: string[] = [];
			if (ctx.transcript) parts.push(`Transcripción:\n${ctx.transcript}`);
			if (ctx.output) parts.push(`Salida:\n${ctx.output}`);
			if (ctx.error) parts.push(`Error:\n${ctx.error}`);
			text = parts.join("\n\n");
		} else if (ctx) {
			text = "Contexto disponible (marcá la casilla para incluirlo).";
		}
		if (this.contextPreviewEl) this.contextPreviewEl.value = text;
		if (this.contextDetailsEl) {
			(this.contextDetailsEl as HTMLDetailsElement).open = this.includeContext;
		}
	}

	private handleCancel(): void {
		if (this.busy && this.abortController) {
			this.abortController.abort();
		} else {
			this.close();
		}
	}

	private async handleDictate(): Promise<void> {
		if (this.busy) return;
		this.setBusy(true);
		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;
		if (this.statusEl) this.statusEl.setText("Dictando...");
		try {
			const text = await this.options.dictate(signal);
			if (signal.aborted) return;
			if (this.descEl) this.descEl.value = text;
			this.report = null;
			this.saved = false;
			this.savedPath = null;
			if (this.savedPathEl) this.savedPathEl.setText("");
			if (this.previewEl) this.previewEl.value = "";
			this.updateControls();
			if (this.statusEl) this.statusEl.setText("Dictado.");
		} catch (e) {
			if (signal.aborted) {
				if (this.statusEl) this.statusEl.setText("Cancelado.");
			} else {
				if (this.statusEl) this.statusEl.setText("No se pudo dictar el reporte.");
			}
		} finally {
			this.abortController = null;
			this.setBusy(false);
		}
	}

	private async handlePrepare(): Promise<void> {
		if (this.busy) return;
		const description = this.descEl?.value ?? "";
		this.setBusy(true);
		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;
		if (this.statusEl) this.statusEl.setText("Preparando reporte...");
		try {
			const report = createFeedbackReport(
				description,
				this.options.version,
				this.options.context,
				this.includeContext,
			);
			if (signal.aborted) return;
			this.report = report;
			this.saved = false;
			this.savedPath = null;
			if (this.savedPathEl) this.savedPathEl.setText("");
			if (this.previewEl) this.previewEl.value = serializeFeedback(report);
			if (this.warningEl) {
				this.warningEl.setText("Hipótesis local: no modifica código ni entrena modelos.");
			}
			if (this.statusEl) this.statusEl.setText("Reporte preparado.");
		} catch (e) {
			if (!signal.aborted) {
				if (this.statusEl) this.statusEl.setText("No se pudo preparar el reporte.");
			}
		} finally {
			this.abortController = null;
			this.setBusy(false);
		}
	}

	private async handleDiagnose(): Promise<void> {
		if (this.busy || !this.report || this.saved) return;
		this.setBusy(true);
		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;
		const report = this.report;
		if (this.statusEl) this.statusEl.setText("Diagnosticando...");
		try {
			const diagnosis = await this.options.diagnose(report, signal);
			if (signal.aborted) return;
			if (this.report === report) {
				report.diagnosis = diagnosis;
				if (this.previewEl) this.previewEl.value = serializeFeedback(report);
				if (this.statusEl) this.statusEl.setText("Diagnóstico actualizado.");
			}
		} catch (e) {
			if (signal.aborted) {
				if (this.statusEl) this.statusEl.setText("Cancelado.");
			} else {
				if (this.statusEl) this.statusEl.setText("No se pudo diagnosticar.");
			}
		} finally {
			this.abortController = null;
			this.setBusy(false);
		}
	}

	private async handleSave(): Promise<void> {
		if (this.busy || !this.report || this.saved) return;
		this.setBusy(true);
		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;
		const report = this.report;
		if (this.statusEl) this.statusEl.setText("Guardando...");
		try {
			const path = await this.options.save(report);
			if (signal.aborted) return;
			this.saved = true;
			this.savedPath = path;
			if (this.savedPathEl) this.savedPathEl.setText(path);
			if (this.statusEl) this.statusEl.setText("Guardado localmente. Copiá y pegá manualmente para compartir.");
			this.updateControls();
		} catch (e) {
			if (signal.aborted) {
				if (this.statusEl) this.statusEl.setText("Cancelado.");
			} else {
				if (this.statusEl) this.statusEl.setText("No se pudo guardar el reporte.");
			}
		} finally {
			this.abortController = null;
			this.setBusy(false);
		}
	}

	private async handleCopy(): Promise<void> {
		if (this.busy || !this.report) return;
		this.setBusy(true);
		const controller = new AbortController();
		this.abortController = controller;
		const signal = controller.signal;
		const report = this.report;
		const previousStatus = report.status;
		if (this.statusEl) this.statusEl.setText("Copiando...");
		try {
			report.status = "exported";
			const text = serializeFeedback(report);
			if (this.previewEl) this.previewEl.value = text;
			const clipboard = (navigator as { clipboard?: { writeText(t: string): Promise<void> } }).clipboard;
			if (!clipboard?.writeText) throw new Error("clipboard unavailable");
			await clipboard.writeText(text);
			if (signal.aborted) return;
			if (this.statusEl) this.statusEl.setText("Copiado. Pegalo manualmente en la conversación.");
		} catch (e) {
			report.status = previousStatus;
			if (this.previewEl) this.previewEl.value = serializeFeedback(report);
			if (signal.aborted) {
				if (this.statusEl) this.statusEl.setText("Cancelado.");
			} else {
				if (this.statusEl) this.statusEl.setText("No se pudo copiar.");
			}
		} finally {
			this.abortController = null;
			this.setBusy(false);
		}
	}
}

export default FeedbackModal;
