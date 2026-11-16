import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFeedbackReport, serializeFeedback } from "../src/feedback";
import LatexVoicePlugin from "../src/main";

const state = vi.hoisted(() => ({
	notices: [] as string[],
	opened: false,
	options: null as any,
	instance: null as any,
	localConfigs: [] as any[],
	createProviderCalls: 0,
	diagnoseFail: false,
	captureDelayMs: 0,
}));

vi.mock("obsidian", () => {
	class Plugin {
		app: unknown;
		commands: Array<{ id: string; name: string; hotkeys?: unknown }> = [];
		constructor(app: unknown) {
			this.app = app;
		}
		async loadData() {
			return null;
		}
		async saveData() {}
		registerDomEvent() {}
		addStatusBarItem() {
			return { setText() {} };
		}
		addRibbonIcon() {
			return {};
		}
		addCommand(cmd: { id: string; name: string; hotkeys?: unknown }) {
			this.commands.push(cmd);
			return cmd;
		}
		addSettingTab() {}
	}
	class Modal {
		contentEl = { empty() {}, createEl() { return { style: {}, setText() {}, empty() {} }; } };
		constructor(public app: unknown) {}
		open() {}
		close() {}
		onClose() {}
	}
	class PlatformCls {
		static isDesktopApp = false;
	}
	class PluginSettingTab {
		containerEl = { empty() {}, createEl() { return {}; } };
		constructor(public app: unknown, public plugin: unknown) {}
	}
	class Setting {
		setName() { return this; }
		setDesc() { return this; }
		addText() { return this; }
		addTextArea() { return this; }
		addToggle() { return this; }
		addButton() { return this; }
		addDropdown() { return this; }
	}
	class Notice {
		constructor(message: string) {
			state.notices.push(message);
		}
	}
	class MarkdownView {}
	return { Plugin, PluginSettingTab, Setting, Notice, MarkdownView, Modal, Platform: PlatformCls, App: class {} };
});

vi.mock("../src/feedback-modal", () => {
	class FeedbackModal {
		app: unknown;
		options: any;
		onClose = () => {};
		constructor(app: unknown, options: any) {
			this.app = app;
			this.options = options;
			state.options = options;
			state.instance = this;
		}
		open() {
			state.opened = true;
		}
		close() {
			if (typeof this.onClose === "function") this.onClose();
		}
	}
	return { default: FeedbackModal };
});

vi.mock("../src/providers/local", () => {
	class LocalProvider {
		config: any;
		transcribe = vi.fn().mockResolvedValue({ text: "transcribed text" });
		convertToLatex = vi.fn().mockImplementation(() => {
			if (state.diagnoseFail) throw new Error("boom secret");
			return { text: "diagnosis text" };
		});
		constructor(config: any) {
			this.config = config;
			state.localConfigs.push(config);
		}
	}
	return { LocalProvider };
});

vi.mock("../src/recorder", () => {
	class AudioRecorder {
		dispose = vi.fn();
		capturePhrase = vi.fn().mockImplementation(async () => {
			if (state.captureDelayMs) await new Promise((r) => setTimeout(r, state.captureDelayMs));
			return new Blob(["x".repeat(900)], { type: "audio/webm" });
		});
	}
	return { AudioRecorder, audioExtension: (t: string) => "webm" };
});

vi.mock("../src/providers", () => ({
	createProvider: vi.fn(() => {
		state.createProviderCalls += 1;
		return {};
	}),
}));

function makePlugin(lastFeedbackContext?: any) {
	const vault = {
		adapter: { exists: vi.fn().mockResolvedValue(false), write: vi.fn().mockResolvedValue(undefined) },
		createFolder: vi.fn().mockResolvedValue(undefined),
		create: vi.fn().mockResolvedValue({ path: "created" }),
		getAbstractFileByPath: vi.fn().mockReturnValue({}),
		modify: vi.fn().mockResolvedValue(undefined),
	};
	const app = { workspace: { getActiveFile: () => null, getActiveViewOfType: () => null }, vault };
	const plugin = new LatexVoicePlugin(app as never, { version: "9.9.9", dir: "x" } as never);
	plugin.settings = {
		providerId: "openai",
		sttPort: 10000,
		llmPort: 8082,
		localLlmApiKey: "localkey",
		transcriptionBaseUrl: "https://remote.example/v1",
		conversionBaseUrl: "https://remote.example/v1",
		silenceMs: 1000,
		graceMs: 2000,
		transcriptionContext: "ctx",
		feedbackIncludeContext: false,
	} as never;
	if (lastFeedbackContext) plugin.lastFeedbackContext = lastFeedbackContext;
	plugin.localManager = { ready: vi.fn().mockResolvedValue({ stt: true, llm: true }) } as never;
	plugin.sessionAbort = null;
	plugin.phraseAbort = null;
	plugin.feedbackModal = undefined;
	return { plugin, app, vault };
}

beforeEach(() => {
	state.notices = [];
	state.opened = false;
	state.options = null;
	state.instance = null;
	state.localConfigs = [];
	state.createProviderCalls = 0;
	state.diagnoseFail = false;
	state.captureDelayMs = 0;
});

describe("feedback integration", () => {
	it("busy session blocks modal open", () => {
		const { plugin } = makePlugin();
		plugin.sessionAbort = new AbortController();
		plugin.openFeedbackReport();
		expect(state.opened).toBe(false);
		expect(plugin.feedbackModal).toBeUndefined();
	});

	it("open captures options and context only when provided", () => {
		const { plugin } = makePlugin();
		plugin.openFeedbackReport();
		expect(state.opened).toBe(true);
		expect(state.options).toBeTruthy();
		expect(state.options.context).toBeUndefined();
		expect(plugin.feedbackModal).toBeDefined();
	});

	it("context provided when lastFeedbackContext set", () => {
		const ctx = { transcript: "t", output: "o" };
		const { plugin } = makePlugin(ctx);
		plugin.openFeedbackReport();
		expect(state.options.context).toEqual(ctx);
	});

	it("diagnose callback uses only local ports", async () => {
		const { plugin } = makePlugin();
		plugin.openFeedbackReport();
		const report = createFeedbackReport("desc", "v");
		const signal = new AbortController().signal;
		const out = await state.options.diagnose(report, signal);
		expect(out).toBe("diagnosis text");
		expect(report.diagnosis).toBe("diagnosis text");
		expect(plugin.localManager.ready).toHaveBeenCalled();
		const cfg = state.localConfigs[state.localConfigs.length - 1];
		expect(cfg.transcriptionBaseUrl).toBe("http://127.0.0.1:10000");
		expect(cfg.conversionBaseUrl).toBe("http://127.0.0.1:8082/v1");
		expect(cfg.transcriptionModel).toBe("whisper-small");
		expect(cfg.conversionModel).toBe("qwen3.5-9b");
		expect(cfg.apiKey).toBe("localkey");
		expect(JSON.stringify(cfg)).not.toContain("remote.example");
		expect(state.createProviderCalls).toBe(0);
	});

	it("no local llm ready rejects without creating provider", async () => {
		const { plugin } = makePlugin();
		plugin.localManager.ready = vi.fn().mockResolvedValue({ stt: true, llm: false });
		plugin.openFeedbackReport();
		const report = createFeedbackReport("d", "v");
		const beforeConfigs = state.localConfigs.length;
		await expect(state.options.diagnose(report, new AbortController().signal)).rejects.toThrow();
		expect(state.localConfigs.length).toBe(beforeConfigs);
		expect(state.createProviderCalls).toBe(0);
	});

	it("save callback creates folder once and writes serialized report", async () => {
		const { plugin, vault } = makePlugin();
		vault.adapter.exists.mockResolvedValue(false);
		plugin.openFeedbackReport();
		const report = createFeedbackReport("desc", "v");
		const path = await state.options.save(report);
		expect(vault.adapter.exists).toHaveBeenCalledWith("Vibe LaTeX Feedback");
		expect(vault.createFolder).toHaveBeenCalledTimes(1);
		expect(vault.createFolder).toHaveBeenCalledWith("Vibe LaTeX Feedback");
		expect(vault.create).toHaveBeenCalledTimes(1);
		const [writtenPath, content] = vault.create.mock.calls[0];
		expect(writtenPath).toBe(`Vibe LaTeX Feedback/${report.id}.json`);
		expect(path).toBe(writtenPath);
		expect(content).toBe(serializeFeedback(report));
		expect(content).not.toContain("localkey");
		expect(content).not.toContain("remote.example");
	});

	it("save callback skips folder when exists", async () => {
		const { plugin, vault } = makePlugin();
		vault.adapter.exists.mockResolvedValue(true);
		plugin.openFeedbackReport();
		const report = createFeedbackReport("d", "v");
		await state.options.save(report);
		expect(vault.createFolder).not.toHaveBeenCalled();
		expect(vault.create).toHaveBeenCalledTimes(1);
	});

	it("closing modal clears feedbackModal", () => {
		const { plugin } = makePlugin();
		plugin.openFeedbackReport();
		expect(plugin.feedbackModal).toBeDefined();
		plugin.feedbackModal.close();
		expect(plugin.feedbackModal).toBeUndefined();
	});

	it("reportProblemByVoice omits context by default", async () => {
		const { plugin, vault } = makePlugin();
		plugin.lastFeedbackContext = { transcript: "t", output: "o" };
		await plugin.reportProblemByVoice();
		expect(vault.create).toHaveBeenCalled();
		const [, content] = vault.create.mock.calls[0];
		expect(content).toContain("transcribed text");
		expect(content).not.toContain('"context"');
	});

	it("reportProblemByVoice includes context when setting true", async () => {
		const { plugin, vault } = makePlugin();
		plugin.settings.feedbackIncludeContext = true;
		plugin.lastFeedbackContext = { transcript: "t", output: "o" };
		await plugin.reportProblemByVoice();
		const [, content] = vault.create.mock.calls[0];
		expect(content).toContain('"context"');
		expect(content).toContain('"transcript": "t"');
	});

	it("reportProblemByVoice saves before modify", async () => {
		const { plugin, vault } = makePlugin();
		await plugin.reportProblemByVoice();
		expect(vault.create).toHaveBeenCalled();
		expect(vault.modify).toHaveBeenCalled();
		expect(vault.create.mock.invocationCallOrder[0]).toBeLessThan(vault.modify.mock.invocationCallOrder[0]);
		const [modifiedFile] = vault.modify.mock.calls[0];
		const created = await vault.create.mock.results[0].value;
		expect(modifiedFile).toBe(created);
	});

	it("reportProblemByVoice diagnose failure leaves initial report", async () => {
		const { plugin, vault } = makePlugin();
		state.diagnoseFail = true;
		await plugin.reportProblemByVoice();
		expect(vault.create).toHaveBeenCalled();
		expect(vault.modify).not.toHaveBeenCalled();
		expect(state.notices.some((n) => n.includes("Reporte guardado sin diagnóstico. Revisá que Qwen local esté disponible."))).toBe(true);
	});

	it("reportProblemByVoice cancellation prevents subsequent writes", async () => {
		const { plugin, vault } = makePlugin();
		state.captureDelayMs = 50;
		const run = plugin.reportProblemByVoice();
		await new Promise((r) => setTimeout(r, 10));
		plugin.feedbackAbort?.abort();
		await run;
		state.captureDelayMs = 0;
		expect(vault.create).not.toHaveBeenCalled();
		expect(vault.modify).not.toHaveBeenCalled();
	});

	it("reportProblemByVoice refuses when modal open", () => {
		const { plugin } = makePlugin();
		plugin.openFeedbackReport();
		const before = state.notices.length;
		plugin.reportProblemByVoice();
		expect(state.notices.length).toBeGreaterThan(before);
		expect(state.notices.some((n) => /cerrá|cerrar|close/i.test(n))).toBe(true);
	});

	it("reportProblemByVoice uses local-only urls", async () => {
		const { plugin } = makePlugin();
		await plugin.reportProblemByVoice();
		const cfg = state.localConfigs[state.localConfigs.length - 1];
		expect(cfg.transcriptionBaseUrl).toBe("http://127.0.0.1:10000");
		expect(cfg.conversionBaseUrl).toBe("http://127.0.0.1:8082/v1");
		expect(JSON.stringify(cfg)).not.toContain("remote.example");
	});

	it("reportProblemByVoice second activation cancels existing", async () => {
		const { plugin } = makePlugin();
		state.captureDelayMs = 1000;
		const first = plugin.reportProblemByVoice();
		await new Promise((r) => setTimeout(r, 10));
		const ctrl = plugin.feedbackAbort!;
		const spy = vi.spyOn(ctrl, "abort");
		await plugin.reportProblemByVoice();
		expect(spy).toHaveBeenCalled();
		state.captureDelayMs = 0;
		await first.catch(() => undefined);
	});
});
