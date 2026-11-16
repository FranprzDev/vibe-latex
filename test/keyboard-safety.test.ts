import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";
import LatexVoicePlugin from "../src/main";
import { TypingGuard } from "../src/typing-guard";

const hoisted = vi.hoisted(() => ({
	convertToLatex: vi.fn(),
	transcribe: vi.fn(),
}));

const obsidianMocks = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock("obsidian", () => {
	class Plugin {
		app: unknown;
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
		addCommand() {
			return {};
		}
		addSettingTab() {}
	}
	class Modal {
		contentEl = { createEl() { return { style: {}, setText() {} }; } };
		constructor(public app: unknown) {}
		open() {}
		close() {}
	}
	class PluginSettingTab {
		containerEl = { empty() {}, createEl() { return {}; } };
		constructor(public app: unknown, public plugin: unknown) {}
	}
	class MarkdownView {}
	class Notice {
		constructor(message: string) {
			obsidianMocks.notices.push(message);
		}
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
	class PlatformCls {
		static isDesktopApp = false;
	}
	return {
		Plugin,
		Modal,
		PluginSettingTab,
		MarkdownView,
		Notice,
		Setting,
		Platform: PlatformCls,
		App: class {},
	};
});

vi.mock("../src/providers", () => ({
	createProvider: vi.fn(() => ({
		transcribe: hoisted.transcribe,
		convertToLatex: hoisted.convertToLatex,
	})),
}));

describe("keyboard safety", () => {
	let value = "abc";
	let activePath = "note.md";
	const replaceRange = vi.fn();
	const editor = {
		getValue: () => value,
		getSelection: () => "abc",
		getCursor: (which: string) =>
			which === "from" ? { line: 0, ch: 0 } : { line: 0, ch: 3 },
		posToOffset: (pos: { line: number; ch: number }) => pos.ch,
		offsetToPos: (off: number) => ({ line: 0, ch: off }),
		replaceRange,
	};
	const getActiveFile = vi.fn(() => ({ path: activePath }));
	const app = {
		workspace: {
			getActiveFile,
			getActiveViewOfType: vi.fn(() => ({ editor })),
		},
	};

	let plugin: LatexVoicePlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		hoisted.convertToLatex.mockReset();
		hoisted.transcribe.mockReset();
		obsidianMocks.notices.length = 0;
		value = "abc";
		activePath = "note.md";
		getActiveFile.mockImplementation(() => ({ path: activePath }));
		replaceRange.mockClear();
		plugin = new LatexVoicePlugin(app as never, {} as never);
		(plugin as any).settings = { ...DEFAULT_SETTINGS };
		(plugin as any).guard = new TypingGuard(() => 1000);
	});

	it("does not replace when user types during conversion", async () => {
		let resolveConvert!: (v: { text: string }) => void;
		hoisted.convertToLatex.mockReturnValue(
			new Promise<{ text: string }>((resolve) => {
			 resolveConvert = resolve;
			}),
		);

		const promise = (plugin as any).convertSelectionToLatex(editor);
		value = "abc typed";
	 resolveConvert({ text: "converted" });
		await promise;

		expect(replaceRange).not.toHaveBeenCalled();
		expect(value).toBe("abc typed");
	});

	it("does not write when active file changes", async () => {
		let resolveConvert!: (v: { text: string }) => void;
		hoisted.convertToLatex.mockReturnValue(
			new Promise<{ text: string }>((resolve) => {
			 resolveConvert = resolve;
			}),
		);

		const promise = (plugin as any).convertSelectionToLatex(editor);
		activePath = "other.md";
	 resolveConvert({ text: "converted" });
		await promise;

		expect(replaceRange).not.toHaveBeenCalled();
	});

	it("writes converted text with captured offsets when unchanged", async () => {
		let resolveConvert!: (v: { text: string }) => void;
		hoisted.convertToLatex.mockReturnValue(
			new Promise<{ text: string }>((resolve) => {
			 resolveConvert = resolve;
			}),
		);

		const promise = (plugin as any).convertSelectionToLatex(editor);
	 resolveConvert({ text: "converted" });
		await promise;

		expect(replaceRange).toHaveBeenCalledWith(
			"converted",
			{ line: 0, ch: 0 },
			{ line: 0, ch: 3 },
		);
	});
});