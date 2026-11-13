import { describe, it, expect } from "vitest";
import {
	clampDuration,
	DEFAULT_CONVERSION_PROMPT_ES,
	DEFAULT_SETTINGS,
	DEFAULT_TRANSCRIPTION_CONTEXT_ES,
	migrateSettings,
	needsApiKey,
} from "../src/settings";

describe("Spanish math dictation defaults", () => {
	it("preserves narrated steps without switching languages", () => {
		expect(DEFAULT_SETTINGS.conversionPrompt).toContain("No resumas ni saltes pasos");
		expect(DEFAULT_SETTINGS.conversionPrompt).toContain("No resuelvas");
		expect(DEFAULT_SETTINGS.transcriptionContext).toContain("fracciones parciales");
		expect(DEFAULT_SETTINGS).not.toHaveProperty("language");
	});
});

describe("migrateSettings", () => {
	it("drops the removed language setting", () => {
		const s = migrateSettings({ language: "en", openaiApiKey: "sk-test" });
		expect(s).not.toHaveProperty("language");
		expect(s.openaiApiKey).toBe("sk-test");
	});

	it("upgrades untouched legacy default prompts to Spanish", () => {
		const s = migrateSettings({
			conversionPrompt: "You convert English dictated text into Obsidian Markdown with LaTeX math.",
			transcriptionContext: "English math dictation: integral, derivative.",
		});
		expect(s.conversionPrompt).toBe(DEFAULT_CONVERSION_PROMPT_ES);
		expect(s.transcriptionContext).toBe(DEFAULT_TRANSCRIPTION_CONTEXT_ES);
	});

	it("respects custom prompts and context", () => {
		const s = migrateSettings({
			conversionPrompt: "mis reglas",
			transcriptionContext: "mi vocabulario",
		});
		expect(s.conversionPrompt).toBe("mis reglas");
		expect(s.transcriptionContext).toBe("mi vocabulario");
	});

	it("keeps a valid correction target and discards a malformed one", () => {
		const target = { filePath: "n.md", from: 1, to: 4, text: "abc" };
		expect(migrateSettings({ lastDictation: target }).lastDictation).toEqual(target);
		expect(migrateSettings({ lastDictation: { from: 1 } }).lastDictation).toBeNull();
	});

	it("defaults previousRemoteSettings to null when absent", () => {
		expect(migrateSettings(null).previousRemoteSettings).toBeNull();
		expect(migrateSettings({ openaiApiKey: "sk-test" }).previousRemoteSettings).toBeNull();
	});

	it("defaults streamingInsert to true when absent or invalid", () => {
		expect(DEFAULT_SETTINGS.streamingInsert).toBe(true);
		expect(migrateSettings(null).streamingInsert).toBe(true);
		expect(migrateSettings({ streamingInsert: "yes" }).streamingInsert).toBe(true);
		expect(migrateSettings({ streamingInsert: false }).streamingInsert).toBe(false);
	});

	it("keeps a well-formed previousRemoteSettings", () => {
		const previous = {
			providerId: "openai",
			transcriptionBaseUrl: "https://api.openai.com/v1",
			conversionBaseUrl: "https://api.openai.com/v1",
			transcriptionModel: "gpt-transcribe",
			conversionModel: "gpt-6-luna",
		};
		expect(migrateSettings({ previousRemoteSettings: previous }).previousRemoteSettings)
			.toEqual(previous);
	});

	it("drops a malformed previousRemoteSettings to null", () => {
		expect(migrateSettings({
			previousRemoteSettings: { providerId: "openai", transcriptionBaseUrl: 5 },
		}).previousRemoteSettings).toBeNull();
		expect(migrateSettings({
			previousRemoteSettings: "not-an-object",
		}).previousRemoteSettings).toBeNull();
	});

	it("merges partial usage counters over the defaults", () => {
		const s = migrateSettings({ usage: { requests: 3 } as never });
		expect(s.usage.requests).toBe(3);
		expect(s.usage.audioSeconds).toBe(0);
	});

	it("ships dictation timing defaults", () => {
		expect(DEFAULT_SETTINGS.silenceMs).toBe(2800);
		expect(DEFAULT_SETTINGS.maxPhraseMs).toBe(60_000);
		expect(DEFAULT_SETTINGS.graceMs).toBe(10_000);
	});

	it("clamps persisted durations during migration", () => {
		const s = migrateSettings({ silenceMs: 10, maxPhraseMs: "abc", graceMs: 1e9 });
		expect(s.silenceMs).toBe(500);
		expect(s.maxPhraseMs).toBe(DEFAULT_SETTINGS.maxPhraseMs);
		expect(s.graceMs).toBe(60_000);
	});

	it("migrates the legacy openaiBaseUrl into both new URLs", () => {
		const s = migrateSettings({ openaiBaseUrl: "http://localhost:9999/v1" });
		expect(s.transcriptionBaseUrl).toBe("http://localhost:9999/v1");
		expect(s.conversionBaseUrl).toBe("http://localhost:9999/v1");
		expect(s).not.toHaveProperty("openaiBaseUrl");
	});

	it("uses default URLs when data is null", () => {
		const s = migrateSettings(null);
		expect(s.transcriptionBaseUrl).toBe("https://api.openai.com/v1");
		expect(s.conversionBaseUrl).toBe("https://api.openai.com/v1");
	});
});

describe("needsApiKey", () => {
	it("is true with default settings", () => {
		expect(needsApiKey(DEFAULT_SETTINGS)).toBe(true);
	});

	it("is false when both URLs point to localhost", () => {
		expect(needsApiKey({
			...DEFAULT_SETTINGS,
			transcriptionBaseUrl: "http://localhost:8000/v1",
			conversionBaseUrl: "http://localhost:11434/v1",
		})).toBe(false);
	});
});

describe("clampDuration", () => {
	it("clamps, rounds and falls back on bad input", () => {
		expect(clampDuration(1234.6, 2800, 500, 10_000)).toBe(1235);
		expect(clampDuration(10, 2800, 500, 10_000)).toBe(500);
		expect(clampDuration(9_999_999, 2800, 500, 10_000)).toBe(10_000);
		expect(clampDuration("nope", 2800, 500, 10_000)).toBe(2800);
		expect(clampDuration(undefined, 2800, 500, 10_000)).toBe(2800);
	});
});

describe("0.5.1 port migration", () => {
	it("moves the untouched 0.5.0 STT port and URL to 10000", () => {
		const s = migrateSettings({
			providerId: "local",
			sttPort: 8081,
			transcriptionBaseUrl: "http://127.0.0.1:8081",
			conversionBaseUrl: "http://127.0.0.1:8082/v1",
		});
		expect(s.sttPort).toBe(10000);
		expect(s.transcriptionBaseUrl).toBe("http://127.0.0.1:10000");
		expect(s.conversionBaseUrl).toBe("http://127.0.0.1:8082/v1");
	});

	it("leaves custom ports and URLs alone", () => {
		const s = migrateSettings({
			sttPort: 9000,
			transcriptionBaseUrl: "http://localhost:9000",
		});
		expect(s.sttPort).toBe(9000);
		expect(s.transcriptionBaseUrl).toBe("http://localhost:9000");
	});
});

describe("DEFAULT_CONVERSION_PROMPT_ES symbol vocabulary", () => {
	it("maps spoken math concepts to LaTeX symbols", () => {
		for (const needle of ["\\infty", "\\sum", "\\prod", "\\lim_{x \\to a}", "\\sqrt", "\\pi", "\\geq", "\\leq", "\\neq", "\\approx", "\\pm", "\\in", "\\forall", "\\exists", "\\cup", "\\cap", "\\alpha", "\\omega"]) {
			expect(DEFAULT_CONVERSION_PROMPT_ES).toContain(needle);
		}
	});

	it("maps spoken format commands to Markdown", () => {
		expect(DEFAULT_CONVERSION_PROMPT_ES).toContain("título");
		expect(DEFAULT_CONVERSION_PROMPT_ES).toContain("# ");
		expect(DEFAULT_CONVERSION_PROMPT_ES).toContain("## ");
		expect(DEFAULT_CONVERSION_PROMPT_ES).toContain("**");
		expect(DEFAULT_CONVERSION_PROMPT_ES).toContain("- ");
	});
});
