import {
	App,
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import type { FileSystemAdapter } from "obsidian";
import { randomBytes } from "crypto";
import {
	dictationReplacementText,
	verifiedDictationRange,
} from "./dictation-range";
import { AudioRecorder, audioExtension } from "./recorder";
import { createProvider } from "./providers";
import { convertImageToLatex, convertPlainText, dictatePipeline } from "./pipeline";
import { cleanPdfText, trailingEllipsisLength } from "./text-clean";
import { friendlyError } from "./errors";
import { INSTALL_STEPS, InstallProgress, LocalModeManager, LocalStatus } from "./local/manager";
import {
	clampDuration,
	DEFAULT_SETTINGS,
	LatexVoiceSettings,
	LastDictation,
	migrateSettings,
	needsApiKey,
} from "./settings";

export default class LatexVoicePlugin extends Plugin {
	declare settings: LatexVoiceSettings;
	localManager!: LocalModeManager;
	private recorder = new AudioRecorder();
	private statusBarEl!: HTMLElement;
	private sessionAbort: AbortController | null = null;
	private pendingSave: Promise<void> = Promise.resolve();

	async onload() {
		await this.loadSettings();

		if (!this.settings.localLlmApiKey) {
			this.settings.localLlmApiKey = randomBytes(24).toString("hex");
			await this.saveSettings();
		}

		const adapter = this.app.vault?.adapter as FileSystemAdapter | undefined;
		const basePath = adapter && typeof adapter.getBasePath === "function"
			? adapter.getBasePath()
			: "";
		this.localManager = new LocalModeManager({
			basePath,
			pluginDir: this.manifest?.dir ?? ".obsidian/plugins/vibe-latex",
			sttPort: this.settings.sttPort,
			llmPort: this.settings.llmPort,
			llmApiKey: this.settings.localLlmApiKey,
			paths: {
				whisperServerPath: this.settings.whisperServerPath,
				llamaServerPath: this.settings.llamaServerPath,
				whisperModelPath: this.settings.whisperModelPath,
				llmModelPath: this.settings.llmModelPath,
			},
		});

		if (this.settings.providerId === "local" && this.settings.autoStartLocal) {
			const status = await this.localManager.status();
			if (status.installed) {
				this.localManager.start().catch((e) => {
					new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
				});
			}
		}

		this.statusBarEl = this.addStatusBarItem();
		this.updateStatus("");

		this.addRibbonIcon("mic", "Vibe LaTeX: dictar", () => {
			void this.toggleDictation();
		});

		this.addCommand({
			id: "toggle-dictation",
			name: "Iniciar o detener el dictado por voz",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "M" }],
			callback: () => void this.toggleDictation(),
		});
		this.addCommand({
			id: "correct-last-dictation",
			name: "Corregir la última frase dictada",
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "R" }],
			callback: () => void this.correctLastDictation(),
		});
		this.addCommand({
			id: "convert-selection-to-latex",
			name: "Convertir la selección a LaTeX",
			editorCallback: (editor) => void this.convertSelectionToLatex(editor),
		});
		this.addCommand({
			id: "paste-clipboard-as-latex",
			name: "Pegar el portapapeles como LaTeX",
			editorCallback: (editor) => void this.pasteClipboardAsLatex(editor),
		});

		this.addSettingTab(new LatexVoiceSettingTab(this.app, this));

		if (!this.settings.openaiApiKey && needsApiKey(this.settings) && !this.settings.devMode) {
			new Notice(
				"Vibe LaTeX: pegá tu clave API de OpenAI en Ajustes → Vibe LaTeX, o configurá un endpoint local.",
				8000,
			);
		}
	}

	private async convertSelectionToLatex(editor: Editor): Promise<void> {
		const selection = editor.getSelection();
		if (!selection.trim()) {
			new Notice("Vibe LaTeX: seleccioná el texto a convertir.");
			return;
		}
		new Notice("Vibe LaTeX: convirtiendo la selección…");
		try {
			const output = await convertPlainText(createProvider(this.settings), selection, this.settings);
			editor.replaceSelection(output);
		} catch (e) {
			new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
		}
	}

	private async readClipboardImage(): Promise<string | null> {
		try {
			const items = await navigator.clipboard.read();
			for (const item of items) {
				const type = item.types.find((t) => t === "image/png" || t === "image/jpeg");
				if (!type) continue;
				const blob = await item.getType(type);
				const buf = new Uint8Array(await blob.arrayBuffer());
				let bin = "";
				for (let i = 0; i < buf.length; i += 8192) {
					bin += String.fromCharCode(...buf.subarray(i, i + 8192));
				}
				return btoa(bin);
			}
			return null;
		} catch {
			return null;
		}
	}

	private async pasteClipboardAsLatex(editor: Editor): Promise<void> {
		const imageBase64 = await this.readClipboardImage();
		if (imageBase64) {
			if (!this.settings.improveEnabled) {
				new Notice(
					"Vibe LaTeX: para pegar imágenes como LaTeX activá \"Revisar con la nube\" en Ajustes → Avanzado.",
				);
				return;
			}
			new Notice("Vibe LaTeX: convirtiendo la imagen…");
			const latex = await convertImageToLatex(imageBase64, this.settings);
			if (!latex) {
				new Notice("Vibe LaTeX: no pude convertir la imagen.");
				return;
			}
			editor.replaceSelection(latex);
			return;
		}
		let raw = "";
		try {
			raw = await navigator.clipboard.readText();
		} catch {
			new Notice("Vibe LaTeX: no pude leer el portapapeles.");
			return;
		}
		const cleaned = cleanPdfText(raw);
		if (!cleaned) {
			new Notice("Vibe LaTeX: el portapapeles está vacío.");
			return;
		}
		new Notice("Vibe LaTeX: convirtiendo el portapapeles…");
		try {
			const output = await convertPlainText(createProvider(this.settings), cleaned, this.settings);
			editor.replaceSelection(output);
		} catch (e) {
			new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
		}
	}

	async onunload() {
		this.sessionAbort?.abort();
		this.recorder.dispose();
		await this.localManager?.stop().catch(() => undefined);
	}

	async loadSettings() {
		this.settings = migrateSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Persists the correction target so it survives a plugin reload. */
	private setLastDictation(target: LastDictation | null) {
		this.settings.lastDictation = target;
		this.pendingSave = this.pendingSave
			.then(() => this.saveSettings())
			.catch(() => undefined);
	}

	private updateStatus(text: string) {
		this.statusBarEl.setText(text ? `Vibe LaTeX: ${text}` : "");
	}

	private async toggleDictation() {
		if (this.settings.devMode && this.settings.testAudioPath) {
			await this.dictateFromFile(this.settings.testAudioPath);
			return;
		}
		if (this.sessionAbort) {
			this.sessionAbort.abort();
			return;
		}
		if (!this.settings.openaiApiKey && needsApiKey(this.settings)) {
			new Notice("Vibe LaTeX: falta la clave API (Ajustes → Vibe LaTeX).");
			return;
		}
		if (!this.app.workspace.getActiveViewOfType(MarkdownView)) {
			new Notice("Vibe LaTeX: abrí una nota antes de dictar.");
			return;
		}
		void this.runSession();
	}

	private correctLastDictation() {
		if (this.sessionAbort) {
			new Notice("Terminá el dictado actual antes de corregir.");
			return;
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = this.app.workspace.getActiveFile();
		const target = this.settings.lastDictation ?? null;
		if (!view || !file || !target || target.filePath !== file.path ||
			!verifiedDictationRange(view.editor.getValue(), target)) {
			new Notice(
				"No encuentro la última frase. Seleccioná el texto que quieras reemplazar y dictá de nuevo.",
			);
			return;
		}
		if (!this.settings.openaiApiKey && needsApiKey(this.settings)) {
			new Notice("Vibe LaTeX: falta la clave API (Ajustes → Vibe LaTeX).");
			return;
		}
		void this.runSession(target);
	}

	private async runSession(replaceTarget?: LastDictation) {
		this.sessionAbort = new AbortController();
		const signal = this.sessionAbort.signal;
		const provider = createProvider(this.settings);

		if (this.settings.providerId === "local") {
			const ready = await this.localManager.ready();
			if (!ready.stt || !ready.llm) {
				new Notice(ready.stt
					? "El servidor de conversión no responde. Esperá a que termine la instalación o reiniciá el modo local en Ajustes."
					: "El servidor de voz no responde. Esperá a que termine la instalación o reiniciá el modo local en Ajustes.");
				this.sessionAbort = null;
				this.updateStatus("");
				return;
			}
		}

		this.updateStatus(replaceTarget ? "corrigiendo..." : "escuchando...");
		new Notice(replaceTarget
			? "Decí de nuevo la frase completa que querés corregir."
			: "Vibe LaTeX: escuchando. Volvé a correr el comando para terminar.");

		try {
			while (!signal.aborted) {
				const blob = await this.recorder.capturePhrase({
					signal,
					silenceMs: this.settings.silenceMs,
					graceMs: this.settings.graceMs,
				});
				if (!blob || blob.size < 800) continue;

				this.updateStatus("procesando...");
				const useStreaming = this.settings.streamingInsert && !replaceTarget;
				const streaming: { range: LastDictation | null } = { range: null };
				try {
					const { output, usage } = await dictatePipeline(
						provider,
						blob,
						`phrase.${blob.type.includes("webm") ? "webm" : "m4a"}`,
						this.settings,
						{
							audioSeconds: this.recorder.lastDurationSeconds,
							signal,
							onStep: (step) =>
								this.updateStatus(step === "transcribing" ? "transcribiendo..." : "convirtiendo..."),
							onTranscript: useStreaming
								? (transcript) => {
									const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
									const activeFile = this.app.workspace.getActiveFile();
									if (!activeView || !activeFile) return;
									const activeEditor = activeView.editor;
									const cursor = activeEditor.getCursor();
									const from = activeEditor.posToOffset(cursor);
									activeEditor.replaceRange(transcript, cursor, cursor);
									activeEditor.setCursor(activeEditor.offsetToPos(from + transcript.length));
									streaming.range = {
										filePath: activeFile.path,
										from,
										to: from + transcript.length,
										text: transcript,
									};
								}
								: undefined,
						},
					);
					await this.recordUsage(usage);
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					const file = this.app.workspace.getActiveFile();
					if (replaceTarget && (!view || !file)) {
						new Notice("Abrí la nota de la última frase para poder corregirla.");
						break;
					}
					if (view && file) {
						const editor = view.editor;
						const streamed = streaming.range;
						const partial = streamed &&
							file.path === streamed.filePath &&
							editor.getValue().slice(streamed.from, streamed.to) === streamed.text
							? streamed
							: null;
						if (partial) {
							editor.replaceRange(
								output,
								editor.offsetToPos(partial.from),
								editor.offsetToPos(partial.to),
							);
							this.setLastDictation({
								filePath: file.path,
								from: partial.from,
								to: partial.from + output.length,
								text: output,
							});
							editor.setCursor(editor.offsetToPos(partial.from + output.length));
						} else {
							if (streamed) {
								new Notice("Vibe LaTeX: inserté la conversión al final (el texto parcial cambió).");
							}
							const text = dictationReplacementText(
								output,
								editor.getSelection(),
								replaceTarget?.text,
							);
							if (replaceTarget) {
								const range = verifiedDictationRange(editor.getValue(), replaceTarget);
								if (file.path !== replaceTarget.filePath || !range) {
									new Notice("La frase cambió durante la corrección; no la reemplacé.");
									break;
								}
								const from = editor.offsetToPos(range.from);
								const to = editor.offsetToPos(range.to);
								editor.replaceRange(text, from, to);
								this.setLastDictation({
									filePath: file.path,
									from: range.from,
									to: range.from + text.length,
									text,
								});
								editor.setCursor(editor.offsetToPos(range.from + text.length));
							} else {
								const from = editor.getCursor("from");
								const to = editor.getCursor("to");
								let start = editor.posToOffset(from);
								if (start === editor.posToOffset(to)) {
									const cut = trailingEllipsisLength(
										editor.getValue().slice(Math.max(0, start - 30), start),
									);
									if (cut > 0) {
										editor.replaceRange("", editor.offsetToPos(start - cut), from);
										start -= cut;
									}
								}
								editor.replaceRange(text, editor.offsetToPos(start), editor.offsetToPos(start));
								this.setLastDictation({
									filePath: file.path,
									from: start,
									to: start + text.length,
									text,
								});
								editor.setCursor(editor.offsetToPos(start + text.length));
							}
						}
					}
					if (this.settings.saveAudio) {
						await this.saveAudioFile(blob);
					}
				} catch (e) {
					new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
				}
				if (replaceTarget) break;
				if (!signal.aborted) this.updateStatus("escuchando...");
			}
		} catch (e) {
			new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
		} finally {
			this.sessionAbort = null;
			this.updateStatus("");
			new Notice("Vibe LaTeX: dictado terminado.");
		}
	}

	private async dictateFromFile(path: string) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Vibe LaTeX: abrí una nota antes de dictar.");
			return;
		}
		try {
			this.updateStatus("transcribiendo...");
			const buffer = await this.app.vault.adapter.readBinary(path);
			const audio = new Blob([buffer]);
			const provider = createProvider(this.settings);
			const { output, usage } = await dictatePipeline(provider, audio, path, this.settings);
			await this.recordUsage(usage);
			view.editor.replaceSelection(output);
			new Notice("Vibe LaTeX: listo (audio de prueba).");
		} catch (e) {
			new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
		} finally {
			this.updateStatus("");
		}
	}

	async recordUsage(u: { audioSeconds?: number; inputTokens?: number; outputTokens?: number }) {
		const usage = this.settings.usage;
		usage.audioSeconds += u.audioSeconds ?? 0;
		usage.inputTokens += u.inputTokens ?? 0;
		usage.outputTokens += u.outputTokens ?? 0;
		usage.requests += 1;
		await this.saveSettings();
	}

	private async saveAudioFile(audio: Blob) {
		const folder = this.settings.audioFolder;
		if (!(await this.app.vault.adapter.exists(folder))) {
			await this.app.vault.createFolder(folder);
		}
		const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
		const name = `${folder}/${stamp}.${audioExtension(audio.type)}`;
		await this.app.vault.createBinary(name, await audio.arrayBuffer());
	}
}

const STEP_LABELS: Record<string, string> = {
	"stt-server": "servidor de voz (whisper.cpp)",
	"llama-server": "servidor de conversión (llama.cpp)",
	"whisper-model": "modelo de voz (whisper small)",
	"llm-model": "modelo de conversión (Qwen3.5 9B)",
};

function formatMb(bytes: number): string {
	return Math.round(bytes / 1_000_000).toLocaleString("es-AR");
}

class LatexVoiceSettingTab extends PluginSettingTab {
	private localSection: HTMLElement | null = null;
	private advancedSection: HTMLElement | null = null;
	private localPhase: "installing" | "starting" | null = null;
	private installPromise: Promise<void> | null = null;
	private lastProgress: InstallProgress | null = null;
	private installError: string | null = null;
	private renderToken = 0;
	private stepEl: HTMLElement | null = null;
	private progressEl: HTMLProgressElement | null = null;
	private detailEl: HTMLElement | null = null;
	private lastSampleTime: number | null = null;
	private lastSampleBytes = 0;
	private speedBytesPerSecond = 0;

	constructor(app: App, private plugin: LatexVoicePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.renderStreamingToggle(containerEl);
		this.localSection = containerEl.createDiv();
		this.advancedSection = containerEl.createDiv();
		void this.renderAll();
	}

	private renderStreamingToggle(container: HTMLElement): void {
		new Setting(container)
			.setName("Inserción progresiva")
			.setDesc("Inserta el texto transcrito al instante y lo reemplaza con el LaTeX convertido. Si falla, desactivala acá.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.streamingInsert).onChange(async (v) => {
					this.plugin.settings.streamingInsert = v;
					await this.plugin.saveSettings();
				})
			);
	}

	private async renderAll(): Promise<void> {
		const token = ++this.renderToken;
		const status = await this.plugin.localManager.status();
		if (token !== this.renderToken) return;
		const section = this.localSection;
		if (!section) return;
		section.empty();
		this.stepEl = null;
		this.progressEl = null;
		this.detailEl = null;
		this.renderLocal(section, status);
		if (this.advancedSection) this.renderAdvanced(this.advancedSection, status);
	}

	private renderLocal(section: HTMLElement, status: LocalStatus): void {
		if (this.localPhase) {
			this.renderProgress(section);
			return;
		}
		if (this.installError) {
			this.renderInstallError(section, this.installError);
			return;
		}
		if (!status.installed) {
			const button = section.createEl("button", { text: "Instalar modo local" });
			button.addClass("mod-cta");
			button.style.width = "100%";
			button.style.padding = "12px";
			button.style.fontSize = "1.1em";
			button.onclick = () => void this.installLocal();
			section.createEl("p", {
				text: "Dictado gratis y sin nube: el plugin descarga e inicia todo solo (~6,5 GB la primera vez).",
			});
			this.renderHowToDictate(section);
			return;
		}

		const localActive = this.plugin.settings.providerId === "local";
		new Setting(section)
			.setName("Modo local")
			.setDesc(`Dictado local ${localActive ? "activado" : "desactivado"}`)
			.addToggle((t) =>
				t.setValue(localActive).onChange(async (value) => {
					if (value) {
						await this.activateLocal();
						try {
							await this.plugin.localManager.start();
						} catch (error) {
							new Notice(`Vibe LaTeX: ${friendlyError(error)}`);
						}
					} else {
						await this.deactivateLocal();
						await this.plugin.localManager.stop();
					}
					this.display();
				})
			);

		const settings = this.plugin.settings;
		section.createEl("p", {
			text: `Servidor de voz (whisper.cpp): ${status.running.stt ? "corriendo" : "detenido"} — puerto ${settings.sttPort}`,
		});
		section.createEl("p", {
			text: `Servidor de conversión (llama.cpp): ${status.running.llm ? "corriendo" : "detenido"} — puerto ${settings.llmPort}`,
		});

		const running = status.running.stt && status.running.llm;
		const row = section.createDiv();
		const toggle = row.createEl("button", { text: running ? "Detener" : "Iniciar" });
		toggle.onclick = async () => {
			toggle.disabled = true;
			try {
				if (running) await this.plugin.localManager.stop();
				else await this.plugin.localManager.start();
			} catch (error) {
				new Notice(`Vibe LaTeX: ${friendlyError(error)}`);
			}
			this.display();
		};

		this.renderHowToDictate(section);
	}

	private renderHowToDictate(section: HTMLElement): void {
		section.createEl("p", {
			text: "Para dictar: ícono de micrófono en la barra lateral izquierda, o el atajo Cmd/Ctrl+Shift+M. También desde la paleta de comandos: «Vibe LaTeX: Iniciar o detener el dictado por voz».",
		});
	}

	private renderProgress(section: HTMLElement): void {
		this.stepEl = section.createEl("p");
		this.progressEl = section.createEl("progress");
		this.progressEl.max = 100;
		this.progressEl.style.width = "100%";
		this.detailEl = section.createEl("p");
		this.updateProgressBlock();
	}

	private renderInstallError(section: HTMLElement, message: string): void {
		const errorEl = section.createEl("p");
		errorEl.style.color = "var(--text-error)";
		errorEl.setText(message);
		const row = section.createDiv();
		const retry = row.createEl("button", { text: "Reintentar" });
		retry.addClass("mod-cta");
		retry.onclick = () => void this.installLocal();
		const cancel = row.createEl("button", { text: "Cancelar" });
		cancel.style.marginLeft = "8px";
		cancel.onclick = () => {
			this.installError = null;
			this.display();
		};
	}

	private updateProgressBlock(): void {
		const stepEl = this.stepEl;
		const progressEl = this.progressEl;
		const detailEl = this.detailEl;
		if (!stepEl || !progressEl || !detailEl) return;

		if (this.localPhase === "starting") {
			stepEl.setText("Iniciando los servidores...");
			progressEl.removeAttribute("value");
			detailEl.setText("");
			return;
		}
		const p = this.lastProgress;
		if (!p) {
			stepEl.setText("Preparando la descarga...");
			progressEl.removeAttribute("value");
			detailEl.setText("");
			return;
		}
		const label = STEP_LABELS[p.step] ?? p.step;
		if (p.phase === "extract") {
			this.lastSampleTime = null;
			this.lastSampleBytes = 0;
			this.speedBytesPerSecond = 0;
			stepEl.setText(`Descomprimiendo ${label}...`);
			progressEl.removeAttribute("value");
			detailEl.setText("");
			return;
		}
		const index = INSTALL_STEPS.indexOf(p.step as (typeof INSTALL_STEPS)[number]);
		stepEl.setText(
			`Descargando ${label} — componente ${index >= 0 ? index + 1 : INSTALL_STEPS.length} de ${INSTALL_STEPS.length}`,
		);
		this.rememberSpeed(p);
		if (p.totalBytes && p.totalBytes > 0) {
			progressEl.value = Math.min(100, (p.downloadedBytes / p.totalBytes) * 100);
		} else {
			progressEl.removeAttribute("value");
		}
		detailEl.setText(this.detailText(p));
	}

	private rememberSpeed(p: InstallProgress): void {
		const now = Date.now();
		if (this.lastSampleTime !== null && p.downloadedBytes >= this.lastSampleBytes) {
			const seconds = (now - this.lastSampleTime) / 1000;
			if (seconds > 0) {
				const instant = (p.downloadedBytes - this.lastSampleBytes) / seconds;
				this.speedBytesPerSecond = this.speedBytesPerSecond > 0
					? this.speedBytesPerSecond * 0.7 + instant * 0.3
					: instant;
			}
		}
		this.lastSampleTime = now;
		this.lastSampleBytes = p.downloadedBytes;
	}

	private detailText(p: InstallProgress): string {
		if (!p.totalBytes || p.totalBytes <= 0) {
			return `${formatMb(p.downloadedBytes)} MB descargados`;
		}
		const pct = Math.round((p.downloadedBytes / p.totalBytes) * 100);
		let text = `${formatMb(p.downloadedBytes)} MB de ${formatMb(p.totalBytes)} MB (${pct}%)`;
		if (this.speedBytesPerSecond > 0) {
			text += ` · ${formatMb(this.speedBytesPerSecond)} MB/s`;
			const remaining = (p.totalBytes - p.downloadedBytes) / this.speedBytesPerSecond;
			if (remaining > 0) {
				const eta = remaining < 90
					? `${Math.max(1, Math.round(remaining))} s`
					: `${Math.max(1, Math.round(remaining / 60))} min`;
				text += ` · quedan ~${eta}`;
			}
		}
		return text;
	}

	private async activateLocal(): Promise<void> {
		const settings = this.plugin.settings;
		if (settings.providerId !== "local") {
			settings.previousRemoteSettings = {
				providerId: settings.providerId,
				transcriptionBaseUrl: settings.transcriptionBaseUrl,
				conversionBaseUrl: settings.conversionBaseUrl,
				transcriptionModel: settings.transcriptionModel,
				conversionModel: settings.conversionModel,
			};
		}
		settings.providerId = "local";
		settings.transcriptionBaseUrl = `http://127.0.0.1:${settings.sttPort}`;
		settings.conversionBaseUrl = `http://127.0.0.1:${settings.llmPort}/v1`;
		settings.transcriptionModel = "whisper-small";
		settings.conversionModel = "qwen3.5-9b";
		await this.plugin.saveSettings();
	}

	private async deactivateLocal(): Promise<void> {
		const settings = this.plugin.settings;
		const previous = settings.previousRemoteSettings;
		if (previous) {
			settings.providerId = previous.providerId;
			settings.transcriptionBaseUrl = previous.transcriptionBaseUrl;
			settings.conversionBaseUrl = previous.conversionBaseUrl;
			settings.transcriptionModel = previous.transcriptionModel;
			settings.conversionModel = previous.conversionModel;
		} else {
			settings.providerId = "openai";
			settings.transcriptionBaseUrl = DEFAULT_SETTINGS.transcriptionBaseUrl;
			settings.conversionBaseUrl = DEFAULT_SETTINGS.conversionBaseUrl;
			settings.transcriptionModel = DEFAULT_SETTINGS.transcriptionModel;
			settings.conversionModel = DEFAULT_SETTINGS.conversionModel;
		}
		settings.previousRemoteSettings = null;
		await this.plugin.saveSettings();
	}

	private async installLocal(): Promise<void> {
		if (this.installPromise) return;
		this.installError = null;
		this.lastProgress = null;
		this.lastSampleTime = null;
		this.lastSampleBytes = 0;
		this.speedBytesPerSecond = 0;
		this.localPhase = "installing";
		new Notice("Instalando el modo local...");
		const promise = (async () => {
			await this.plugin.localManager.install((p) => {
				if (p.phase === "download" && this.lastProgress?.step !== p.step) {
					this.lastSampleTime = null;
					this.lastSampleBytes = 0;
					this.speedBytesPerSecond = 0;
				}
				this.lastProgress = p;
				this.updateProgressBlock();
			});
			await this.activateLocal();
			this.localPhase = "starting";
			this.updateProgressBlock();
			await this.plugin.localManager.start();
			new Notice("Modo local instalado y activo");
		})();
		this.installPromise = promise;
		void this.renderAll();
		promise
			.then(() => {
				this.installPromise = null;
				this.localPhase = null;
				this.lastProgress = null;
				this.display();
			})
			.catch((error) => {
				this.installPromise = null;
				this.localPhase = null;
				new Notice("No se pudo instalar el modo local");
				this.installError = error instanceof Error ? error.message : String(error);
				this.display();
			});
	}

	private async syncPorts(): Promise<void> {
		const s = this.plugin.settings;
		if (s.providerId !== "local") return;
		const status = await this.plugin.localManager.status();
		if (!status.running.stt && !status.running.llm) return;
		try {
			await this.plugin.localManager.updatePorts(s.sttPort, s.llmPort);
		} catch (e) {
			new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
		}
	}

	private subHeader(container: HTMLElement, text: string): void {
		const el = container.createEl("h4", { text });
		el.style.margin = "16px 0 4px";
	}

	private renderAdvanced(container: HTMLElement, status: LocalStatus): void {
		container.empty();
		const header = container.createDiv();
		header.style.cursor = "pointer";
		header.style.fontWeight = "bold";
		header.style.marginTop = "16px";
		const chevron = header.createSpan({ text: "▸" });
		header.createSpan({ text: " Avanzado" });
		const content = container.createDiv();
		content.style.display = "none";
		header.onclick = () => {
			const expanded = content.style.display !== "none";
			content.style.display = expanded ? "none" : "block";
			chevron.setText(expanded ? "▸" : "▾");
		};

		this.renderServerGroup(content, status);
		this.renderPathsGroup(content);
		this.renderProviderGroup(content);
		this.renderPromptGroup(content);
		this.renderImproveGroup(content);
		this.renderRecordingGroup(content);
		this.renderUsageGroup(content);
	}

	private renderServerGroup(container: HTMLElement, status: LocalStatus): void {
		this.subHeader(container, "Servidores locales");
		const s = this.plugin.settings;

		new Setting(container)
			.setName("Puerto de transcripción")
			.setDesc("whisper.cpp escucha en este puerto.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1024";
				t.inputEl.max = "65535";
				t.setValue(String(s.sttPort));
				t.onChange(async (v) => {
					const n = Number(v);
					if (!Number.isFinite(n)) return;
					s.sttPort = clampDuration(n, DEFAULT_SETTINGS.sttPort, 1024, 65_535);
					await this.plugin.saveSettings();
					await this.syncPorts();
				});
			});

		new Setting(container)
			.setName("Puerto de conversión")
			.setDesc("llama-server escucha en este puerto.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1024";
				t.inputEl.max = "65535";
				t.setValue(String(s.llmPort));
				t.onChange(async (v) => {
					const n = Number(v);
					if (!Number.isFinite(n)) return;
					s.llmPort = clampDuration(n, DEFAULT_SETTINGS.llmPort, 1024, 65_535);
					await this.plugin.saveSettings();
					await this.syncPorts();
				});
			});

		new Setting(container)
			.setName("Iniciar los servidores al abrir Obsidian")
			.addToggle((t) =>
				t.setValue(s.autoStartLocal).onChange(async (v) => {
					s.autoStartLocal = v;
					await this.plugin.saveSettings();
				})
			);

		if (status.installed) {
			new Setting(container)
				.setName("Desinstalar modo local")
				.setDesc("Elimina los binarios y modelos descargados.")
				.addButton((b) => {
					let armed = false;
					let timer = 0;
					b.setButtonText("Desinstalar").setWarning().onClick(async () => {
						if (!armed) {
							armed = true;
							b.setButtonText("Confirmar desinstalación");
							timer = window.setTimeout(() => {
								armed = false;
								b.setButtonText("Desinstalar");
							}, 5000);
							return;
						}
						window.clearTimeout(timer);
						b.setDisabled(true);
						try {
							await this.plugin.localManager.uninstall();
							new Notice("Modo local desinstalado");
						} catch (e) {
							new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
						}
						this.display();
					});
				});
		}
	}

	private renderProviderGroup(container: HTMLElement): void {
		this.subHeader(container, "Proveedor y endpoints");
		const s = this.plugin.settings;

		new Setting(container)
			.setName("Configuración rápida")
			.setDesc("Usá tu propia clave de OpenAI, o un endpoint local gratuito (Ollama + Speaches) sin clave.")
			.addButton((b) =>
				b.setButtonText("OpenAI").onClick(async () => {
					s.transcriptionBaseUrl = "https://api.openai.com/v1";
					s.conversionBaseUrl = "https://api.openai.com/v1";
					s.transcriptionModel = DEFAULT_SETTINGS.transcriptionModel;
					s.conversionModel = DEFAULT_SETTINGS.conversionModel;
					await this.plugin.saveSettings();
					this.display();
				})
			)
			.addButton((b) =>
				b.setButtonText("Local gratis").onClick(async () => {
					s.transcriptionBaseUrl = "http://localhost:8000/v1";
					s.conversionBaseUrl = "http://localhost:11434/v1";
					s.transcriptionModel = "Systran/faster-whisper-small";
					s.conversionModel = "qwen3.5:9b";
					await this.plugin.saveSettings();
					this.display();
				})
			);

		const apiKeySetting = new Setting(container)
			.setName("Clave API de OpenAI")
			.setDesc("Necesaria solo para OpenAI u otro servicio con clave. Dejala vacía para endpoints locales.")
			.addText((t) =>
				t.setPlaceholder("sk-...")
					.setValue(s.openaiApiKey)
					.onChange(async (v) => {
						s.openaiApiKey = v.trim();
						await this.plugin.saveSettings();
					})
			);
		apiKeySetting.controlEl.querySelector("input")?.setAttribute("type", "password");

		new Setting(container)
			.setName("URL de transcripción")
			.setDesc("OpenAI: https://api.openai.com/v1 · Local: http://localhost:8000/v1 (Speaches o whisper.cpp)")
			.addText((t) =>
				t.setValue(s.transcriptionBaseUrl).onChange(async (v) => {
					s.transcriptionBaseUrl = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(container)
			.setName("URL de conversión")
			.setDesc("OpenAI: https://api.openai.com/v1 · Local: http://localhost:11434/v1 (Ollama)")
			.addText((t) =>
				t.setValue(s.conversionBaseUrl).onChange(async (v) => {
					s.conversionBaseUrl = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(container)
			.setName("Modelo de transcripción")
			.addText((t) =>
				t.setValue(s.transcriptionModel).onChange(async (v) => {
					s.transcriptionModel = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(container)
			.setName("Modelo de conversión")
			.addText((t) =>
				t.setValue(s.conversionModel).onChange(async (v) => {
					s.conversionModel = v.trim();
					await this.plugin.saveSettings();
				})
			);
	}

	private renderPromptGroup(container: HTMLElement): void {
		this.subHeader(container, "Prompts");
		const s = this.plugin.settings;

		new Setting(container)
			.setName("Contexto de transcripción")
			.setDesc("Vocabulario matemático que se envía al modelo de transcripción.")
			.addTextArea((t) => {
				t.setValue(s.transcriptionContext).onChange(async (v) => {
					s.transcriptionContext = v;
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 3;
				t.inputEl.cols = 40;
			});

		new Setting(container)
			.setName("Instrucciones de conversión")
			.setDesc("Reglas para convertir el dictado en Markdown y LaTeX.")
			.addTextArea((t) => {
				t.setValue(s.conversionPrompt).onChange(async (v) => {
					s.conversionPrompt = v;
					await this.plugin.saveSettings();
				});
				t.inputEl.rows = 10;
				t.inputEl.cols = 40;
			});
	}

	private renderPathsGroup(container: HTMLElement): void {
		this.subHeader(container, "Rutas manuales");
		const s = this.plugin.settings;
		const pathSetting = (
			name: string,
			desc: string,
			get: () => string,
			set: (v: string) => void,
		) =>
			new Setting(container)
				.setName(name)
				.setDesc(desc)
				.addText((t) =>
					t.setValue(get()).onChange(async (v) => {
						set(v.trim());
						await this.plugin.saveSettings();
					}),
				);
		pathSetting(
			"whisper-server",
			"Ejecutable de whisper.cpp ya instalado (vacío: se busca solo).",
			() => s.whisperServerPath,
			(v) => (s.whisperServerPath = v),
		);
		pathSetting(
			"llama-server",
			"Ejecutable de llama.cpp ya instalado (vacío: se busca solo).",
			() => s.llamaServerPath,
			(v) => (s.llamaServerPath = v),
		);
		pathSetting(
			"Modelo de voz (.bin/.gguf)",
			"Modelo de whisper ya descargado (vacío: se busca ggml-small.bin).",
			() => s.whisperModelPath,
			(v) => (s.whisperModelPath = v),
		);
		pathSetting(
			"Modelo de conversión (.gguf)",
			"Modelo de lenguaje ya descargado (vacío: se busca Qwen3.5-9B-Q4_K_M.gguf).",
			() => s.llmModelPath,
			(v) => (s.llmModelPath = v),
		);
	}

	private renderImproveGroup(container: HTMLElement): void {
		this.subHeader(container, "Corrección de términos");
		const s = this.plugin.settings;


		new Setting(container)
			.setName("Revisar con la nube")
			.setDesc(
				"Envía cada resultado a un worker gratuito que corrige términos técnicos mal transcritos sin agregar contenido. También habilita pegar imágenes del portapapeles como LaTeX. Si falla, se usa el texto original.",
			)
			.addToggle((t) =>
				t.setValue(s.improveEnabled).onChange(async (v) => {
					s.improveEnabled = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(container)
			.setName("URL del worker")
			.setDesc("Endpoint del paso de revisión.")
			.addText((t) =>
				t.setValue(s.improveUrl).onChange(async (v) => {
					s.improveUrl = v.trim();
					await this.plugin.saveSettings();
				}),
			);
	}

	private renderRecordingGroup(container: HTMLElement): void {
		this.subHeader(container, "Grabación");
		const s = this.plugin.settings;

		new Setting(container)
			.setName("Guardar audio")
			.setDesc("Conservá las grabaciones en la bóveda.")
			.addToggle((t) =>
				t.setValue(s.saveAudio).onChange(async (v) => {
					s.saveAudio = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(container)
			.setName("Carpeta de audio")
			.addText((t) =>
				t.setValue(s.audioFolder).onChange(async (v) => {
					s.audioFolder = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(container)
			.setName("Duración de la pausa (s)")
			.setDesc("Silencio que cierra cada frase dictada.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "0.5";
				t.inputEl.max = "10";
				t.inputEl.step = "0.5";
				t.setValue(String(s.silenceMs / 1000));
				t.onChange(async (v) => {
					const secs = Number(v);
					if (!Number.isFinite(secs)) return;
					s.silenceMs = clampDuration(secs * 1000, DEFAULT_SETTINGS.silenceMs, 500, 10_000);
					await this.plugin.saveSettings();
				});
			});
	}

	private renderUsageGroup(container: HTMLElement): void {
		this.subHeader(container, "Uso");
		const s = this.plugin.settings;
		const u = s.usage;
		new Setting(container)
			.setName("Uso")
			.setDesc(
				`${u.requests} dictados · ${Math.round(u.audioSeconds)} s de audio · ` +
					`${u.inputTokens + u.outputTokens} tokens`,
			)
			.addButton((b) =>
				b.setButtonText("Restablecer").onClick(async () => {
					s.usage = { audioSeconds: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
					await this.plugin.saveSettings();
					this.display();
				})
			);
	}
}
