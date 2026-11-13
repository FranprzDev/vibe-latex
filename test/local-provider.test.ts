import { describe, it, expect, vi, afterEach } from "vitest";
import { LocalProvider } from "../src/providers/local";

const provider = new LocalProvider({
	transcriptionBaseUrl: "http://127.0.0.1:8081",
	conversionBaseUrl: "http://127.0.0.1:8082/v1",
	transcriptionModel: "whisper-small",
	conversionModel: "qwen3.5-9b",
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

describe("LocalProvider.transcribe", () => {
	it("posts multipart WAV to /inference with response_format json and returns trimmed text", async () => {
		mockFetchOnce({ text: "  integral de a a b  " });
		const blob = new Blob(["fake-audio"], { type: "audio/wav" });
		const out = await provider.transcribe(blob, "d.wav", {
			language: "es",
			contextPrompt: "math",
		});
		expect(out.text).toBe("integral de a a b");
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe("http://127.0.0.1:8081/inference");
		expect(init.method).toBe("POST");
		const form = init.body as FormData;
		expect(form.get("response_format")).toBe("json");
		expect(form.get("language")).toBe("es");
		expect(form.get("prompt")).toBe("math");
		const file = form.get("file") as File;
		expect(file).toBeTruthy();
		expect(file.name).toBe("d.wav");
	});

	it("omits the prompt when no context is given", async () => {
		mockFetchOnce({ text: "hola" });
		await provider.transcribe(new Blob(["x"], { type: "audio/wav" }), "d.wav", {});
		const form = vi.mocked(fetch).mock.calls[0][1].body as FormData;
		expect(form.get("prompt")).toBeNull();
	});

	it("throws on API error", async () => {
		mockFetchOnce({ error: { message: "bad audio" } }, false, 500);
		await expect(
			provider.transcribe(new Blob(["x"], { type: "audio/wav" }), "d.wav", {}),
		).rejects.toThrow("bad audio");
	});
});

describe("LocalProvider.convertToLatex", () => {
	it("posts to /chat/completions without Authorization and returns trimmed content", async () => {
		mockFetchOnce({
			choices: [{ message: { content: "  $\\int_a^b f(x)$  " } }],
			usage: { prompt_tokens: 7, completion_tokens: 3 },
		});
		const out = await provider.convertToLatex("integral de a a b", {
			systemPrompt: "convert",
		});
		expect(out.text).toBe("$\\int_a^b f(x)$");
		expect(out.inputTokens).toBe(7);
		expect(out.outputTokens).toBe(3);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe("http://127.0.0.1:8082/v1/chat/completions");
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("qwen3.5-9b");
		expect(body.messages[0]).toEqual({ role: "system", content: "convert" });
		expect(body.messages[1].role).toBe("user");
	});

	it("throws when response has no content", async () => {
		mockFetchOnce({ choices: [] });
		await expect(
			provider.convertToLatex("x", { systemPrompt: "p" }),
		).rejects.toThrow();
	});

	it("propagates the error message on !res.ok", async () => {
		mockFetchOnce({ error: { message: "server down" } }, false, 503);
		await expect(
			provider.convertToLatex("x", { systemPrompt: "p" }),
		).rejects.toThrow("server down");
	});
});
