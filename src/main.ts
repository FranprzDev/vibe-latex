import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import {
	dictationReplacementText,
	verifiedDictationRange,
} from "./dictation-range";
import { AudioRecorder, audioExtension } from "./recorder";
import { createProvider } from "./providers";
import { dictatePipeline } from "./pipeline";
import { friendlyError } from "./errors";
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
	private recorder = new AudioRecorder();
	private statusBarEl!: HTMLElement;
	private sessionAbort: AbortController | null = null;
	private pendingSave: Promise<void> = Promise.resolve();

	async onload() {
		await this.loadSettings();
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

		this.addSettingTab(new LatexVoiceSettingTab(this.app, this));

		if (!this.settings.openaiApiKey && needsApiKey(this.settings) && !this.settings.devMode) {
			new Notice(
				"Vibe LaTeX: pegá tu clave API de OpenAI en Ajustes → Vibe LaTeX, o configurá un endpoint local.",
				8000,
			);
		}
	}

	onunload() {
		this.sessionAbort?.abort();
		this.recorder.dispose();
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
		this.updateStatus(replaceTarget ? "corrigiendo…" : "escuchando…");
		new Notice(replaceTarget
			? "Decí de nuevo la frase completa que querés corregir."
			: "Vibe LaTeX: escuchando. Volvé a correr el comando para terminar.");

		try {
			while (!signal.aborted) {
				const blob = await this.recorder.capturePhrase({
					signal,
					silenceMs: this.settings.silenceMs,
					maxMs: this.settings.maxPhraseMs,
					graceMs: this.settings.graceMs,
				});
				if (!blob || blob.size < 800) continue;

				this.updateStatus("procesando…");
				try {
					const { output, usage } = await dictatePipeline(
						provider,
						blob,
						`phrase.${blob.type.includes("webm") ? "webm" : "m4a"}`,
						this.settings,
						{
							audioSeconds: this.recorder.lastDurationSeconds,
							signal,
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
							const start = editor.posToOffset(from);
							editor.replaceRange(text, from, to);
							this.setLastDictation({
								filePath: file.path,
								from: start,
								to: start + text.length,
								text,
							});
							editor.setCursor(editor.offsetToPos(start + text.length));
						}
					}
					if (this.settings.saveAudio) {
						await this.saveAudioFile(blob);
					}
				} catch (e) {
					new Notice(`Vibe LaTeX: ${friendlyError(e)}`);
				}
				if (replaceTarget) break;
				if (!signal.aborted) this.updateStatus("escuchando…");
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
			this.updateStatus("transcribiendo…");
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

class LatexVoiceSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: LatexVoicePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		containerEl.createEl("p", {
			text: "Usá tu propia clave de OpenAI, o un endpoint local gratuito (Ollama + Speaches) sin clave.",
		});

		const apiKeySetting = new Setting(containerEl)
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

		new Setting(containerEl)
			.setName("Configuración rápida")
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
					s.conversionModel = "qwen2.5:7b";
					await this.plugin.saveSettings();
					this.display();
				})
			);

		new Setting(containerEl)
			.setName("URL de transcripción")
			.setDesc("OpenAI: https://api.openai.com/v1 · Local: http://localhost:8000/v1 (Speaches o whisper.cpp)")
			.addText((t) =>
				t.setValue(s.transcriptionBaseUrl).onChange(async (v) => {
					s.transcriptionBaseUrl = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("URL de conversión")
			.setDesc("OpenAI: https://api.openai.com/v1 · Local: http://localhost:11434/v1 (Ollama)")
			.addText((t) =>
				t.setValue(s.conversionBaseUrl).onChange(async (v) => {
					s.conversionBaseUrl = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Modelo de transcripción")
			.addText((t) =>
				t.setValue(s.transcriptionModel).onChange(async (v) => {
					s.transcriptionModel = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Modelo de conversión")
			.addText((t) =>
				t.setValue(s.conversionModel).onChange(async (v) => {
					s.conversionModel = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
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

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName("Guardar audio")
			.setDesc("Conservá las grabaciones en la bóveda.")
			.addToggle((t) =>
				t.setValue(s.saveAudio).onChange(async (v) => {
					s.saveAudio = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Carpeta de audio")
			.addText((t) =>
				t.setValue(s.audioFolder).onChange(async (v) => {
					s.audioFolder = v.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
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

		new Setting(containerEl)
			.setName("Duración máxima de la frase (s)")
			.setDesc("Corta una frase que se extiende demasiado.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "5";
				t.inputEl.max = "300";
				t.inputEl.step = "5";
				t.setValue(String(s.maxPhraseMs / 1000));
				t.onChange(async (v) => {
					const secs = Number(v);
					if (!Number.isFinite(secs)) return;
					s.maxPhraseMs = clampDuration(secs * 1000, DEFAULT_SETTINGS.maxPhraseMs, 5_000, 300_000);
					await this.plugin.saveSettings();
				});
			});

		const u = s.usage;
		new Setting(containerEl)
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
