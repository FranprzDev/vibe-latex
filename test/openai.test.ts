import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "../src/providers/openai";

const provider = new OpenAIProvider({
	apiKey: "sk-test",
	transcriptionBaseUrl: "https://api.openai.com/v1",
	conversionBaseUrl: "https://api.openai.com/v1",
	transcriptionModel: "gpt-transcribe",
	conversionModel: "gpt-6-luna",
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok,
			status,
			json: async () => body,
		})),
	);
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAIProvider.transcribe", () => {
	it("posts multipart form to /audio/transcriptions and returns text", async () => {
		mockFetchOnce({ text: "integral de a a b", duration: 3.2 });
		const blob = new Blob(["fake-audio"], { type: "audio/mp4" });
		const out = await provider.transcribe(blob, "d.m4a", {
			language: "es",
			contextPrompt: "math",
		});
		expect(out.text).toBe("integral de a a b");
		expect(out.durationSeconds).toBe(3.2);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
		expect(init.method).toBe("POST");
		const form = init.body as FormData;
		expect(form.get("model")).toBe("gpt-transcribe");
		expect(form.get("language")).toBe("es");
		expect(form.get("prompt")).toBe("math");
	});

	it("throws on API error", async () => {
		mockFetchOnce({ error: { message: "bad key" } }, false, 401);
		await expect(
			provider.transcribe(new Blob(["x"]), "d.m4a", {}),
		).rejects.toThrow("bad key");
	});

	it("omits the Authorization header when apiKey is empty", async () => {
		const local = new OpenAIProvider({
			apiKey: "",
			transcriptionBaseUrl: "https://api.openai.com/v1",
			conversionBaseUrl: "https://api.openai.com/v1",
			transcriptionModel: "gpt-transcribe",
			conversionModel: "gpt-6-luna",
		});
		mockFetchOnce({ text: "hola" });
		await local.transcribe(new Blob(["x"]), "d.m4a", {});
		const init = vi.mocked(fetch).mock.calls[0][1];
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});
});

describe("OpenAIProvider.convertToLatex", () => {
	it("sends system prompt + transcript and returns trimmed content", async () => {
		mockFetchOnce({
			choices: [{ message: { content: "  $\\int_a^b f(x)$  " } }],
			usage: { prompt_tokens: 100, completion_tokens: 20 },
		});
		const out = await provider.convertToLatex("integral de a a b", {
			systemPrompt: "convert",
		});
		expect(out.text).toBe("$\\int_a^b f(x)$");
		expect(out.inputTokens).toBe(100);
		expect(out.outputTokens).toBe(20);
		const init = vi.mocked(fetch).mock.calls[0][1];
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("gpt-6-luna");
		expect(body.messages[0]).toEqual({ role: "system", content: "convert" });
		expect(body.messages[1].role).toBe("user");
	});

	it("throws when response has no content", async () => {
		mockFetchOnce({ choices: [] });
		await expect(
			provider.convertToLatex("x", { systemPrompt: "p" }),
		).rejects.toThrow();
	});
});

describe("OpenAIProvider base URLs", () => {
	it("uses separate transcription and conversion URLs", async () => {
		const split = new OpenAIProvider({
			apiKey: "",
			transcriptionBaseUrl: "http://localhost:8000/v1/",
			conversionBaseUrl: "http://localhost:11434/v1/",
			transcriptionModel: "whisper",
			conversionModel: "qwen",
		});
		mockFetchOnce({ text: "integral" });
		await split.transcribe(new Blob(["x"]), "d.m4a", {});
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
			"http://localhost:8000/v1/audio/transcriptions",
		);
		mockFetchOnce({ choices: [{ message: { content: "ok" } }] });
		await split.convertToLatex("integral", { systemPrompt: "p" });
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
			"http://localhost:11434/v1/chat/completions",
		);
	});
});
