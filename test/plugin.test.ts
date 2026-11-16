import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notices: [] as string[] }));

vi.mock("obsidian", () => {
	class Plugin {
		app: unknown;
		commands: Array<{ id: string; name: string }> = [];
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
		contentEl = { createEl() { return { style: {}, setText() {} }; } };
		constructor(public app: unknown) {}
		open() {}
		close() {}
	}
	class PlatformCls {
		static isDesktopApp = false;
	}
	class PluginSettingTab {
		containerEl = { empty() {}, createEl() { return {}; } };
		constructor(public app: unknown, public plugin: unknown) {}
	}
	class Setting {
		setName() {
			return this;
		}
		setDesc() {
			return this;
		}
		addText() {
			return this;
		}
		addTextArea() {
			return this;
		}
		addToggle() {
			return this;
		}
		addButton() {
			return this;
		}
		addDropdown() {
			return this;
		}
	}
	class Notice {
		constructor(message: string) {
			mocks.notices.push(message);
		}
	}
	class MarkdownView {}
	return { Plugin, PluginSettingTab, Setting, Notice, MarkdownView, Modal, Platform: PlatformCls, App: class {} };
});

import LatexVoicePlugin from "../src/main";

describe("LatexVoicePlugin smoke", () => {
	it("registers the dictation and correction commands on load", async () => {
		const plugin = new LatexVoicePlugin({} as never, {} as never);
		vi.stubGlobal("document", {});
		await plugin.onload();
		const commands = (plugin as unknown as { commands: { id: string; hotkeys?: unknown }[] }).commands;
		const ids = commands.map((c) => c.id);
		expect(ids).toContain("toggle-dictation");
		expect(ids).toContain("correct-last-dictation");
		const reportCmd = commands.find((c) => c.id === "report-problem");
		expect(reportCmd).toBeDefined();
		expect(reportCmd?.hotkeys).toBeUndefined();
		const correctCmd = commands.find((c) => c.id === "correct-last-dictation");
		expect(correctCmd?.hotkeys).toEqual([{ modifiers: ["Mod", "Shift"], key: "R" }]);
		expect(() => plugin.onunload()).not.toThrow();
	});
});
