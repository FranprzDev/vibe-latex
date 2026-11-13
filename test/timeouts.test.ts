import { describe, it, expect, vi, afterEach } from "vitest";
import { CONVERT_TIMEOUT_MS, TRANSCRIBE_TIMEOUT_MS } from "../src/providers/timeouts";
import { OpenAIProvider } from "../src/providers/openai";
import { LocalProvider } from "../src/providers/local";

const openai = new OpenAIProvider({
	apiKey: "sk-test",
	transcriptionBaseUrl: "https://api.openai.com/v1",
	conversionBaseUrl: "https://api.openai.com/v1",
	transcriptionModel: "gpt-transcribe",
	conversionModel: "gpt-6-luna",
});

const local = new LocalProvider({
	transcriptionBaseUrl: "http://127.0.0.1:8081",
	conversionBaseUrl: "http://127.0.0.1:8082/v1",
	transcriptionModel: "whisper-small",
	conversionModel: "qwen3.5-9b",
});

function mockFetchOnce(body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
	);
}

function spyOnTimeout() {
	const original = AbortSignal.timeout;
	const spy = vi.fn((ms: number) => original.call(AbortSignal, ms));
	AbortSignal.timeout = spy as typeof AbortSignal.timeout;
	return { spy, restore: () => (AbortSignal.timeout = original) };
}

afterEach(() => vi.unstubAllGlobals());

describe("provider timeouts", () => {
	it("exports longer budgets for the local 9B model", () => {
		expect(TRANSCRIBE_TIMEOUT_MS).toBe(120_000);
		expect(CONVERT_TIMEOUT_MS).toBe(180_000);
	});

	it("uses the shared timeouts for OpenAI requests", async () => {
		const { spy, restore } = spyOnTimeout();
		try {
			mockFetchOnce({ text: "ok" });
			await openai.transcribe(new Blob(["x"]), "d.m4a", {});
			expect(spy).toHaveBeenCalledWith(TRANSCRIBE_TIMEOUT_MS);
			mockFetchOnce({ choices: [{ message: { content: "ok" } }] });
			await openai.convertToLatex("x", { systemPrompt: "p" });
			expect(spy).toHaveBeenCalledWith(CONVERT_TIMEOUT_MS);
		} finally {
			restore();
		}
	});

	it("uses the shared timeouts for local requests", async () => {
		const { spy, restore } = spyOnTimeout();
		try {
			mockFetchOnce({ text: "ok" });
			await local.transcribe(new Blob(["x"], { type: "audio/wav" }), "d.wav", {});
			expect(spy).toHaveBeenCalledWith(TRANSCRIBE_TIMEOUT_MS);
			mockFetchOnce({ choices: [{ message: { content: "ok" } }] });
			await local.convertToLatex("x", { systemPrompt: "p" });
			expect(spy).toHaveBeenCalledWith(CONVERT_TIMEOUT_MS);
		} finally {
			restore();
		}
	});
});
