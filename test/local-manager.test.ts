import { describe, it, expect } from "vitest";
import { resolveAssets } from "../src/local/manager";
import { DEFAULT_SETTINGS, migrateSettings, needsApiKey } from "../src/settings";

const STT_BASE = "https://github.com/FranprzDev/vibe-latex/releases/latest/download";
const LLAMA_BASE = "https://github.com/ggml-org/llama.cpp/releases/download/b12340";

describe("resolveAssets", () => {
	it("maps win32/x64", () => {
		const a = resolveAssets("win32", "x64");
		expect(a).not.toBeNull();
		expect(a!.stt.url).toBe(`${STT_BASE}/vibe-stt-server-windows-x64.zip`);
		expect(a!.stt.fileName).toBe("vibe-stt-server-windows-x64.zip");
		expect(a!.llama.url).toBe(`${LLAMA_BASE}/llama-b12340-bin-win-vulkan-x64.zip`);
		expect(a!.llama.fileName).toBe("llama-b12340-bin-win-vulkan-x64.zip");
	});

	it("maps darwin/arm64", () => {
		const a = resolveAssets("darwin", "arm64");
		expect(a).not.toBeNull();
		expect(a!.stt.url).toBe(`${STT_BASE}/vibe-stt-server-macos-arm64.tar.gz`);
		expect(a!.stt.fileName).toBe("vibe-stt-server-macos-arm64.tar.gz");
		expect(a!.llama.url).toBe(`${LLAMA_BASE}/llama-b12340-bin-macos-arm64.tar.gz`);
		expect(a!.llama.fileName).toBe("llama-b12340-bin-macos-arm64.tar.gz");
	});

	it("maps darwin/x64", () => {
		const a = resolveAssets("darwin", "x64");
		expect(a).not.toBeNull();
		expect(a!.stt.url).toBe(`${STT_BASE}/vibe-stt-server-macos-x64.tar.gz`);
		expect(a!.stt.fileName).toBe("vibe-stt-server-macos-x64.tar.gz");
		expect(a!.llama.url).toBe(`${LLAMA_BASE}/llama-b12340-bin-macos-x64.tar.gz`);
		expect(a!.llama.fileName).toBe("llama-b12340-bin-macos-x64.tar.gz");
	});

	it("maps linux/x64", () => {
		const a = resolveAssets("linux", "x64");
		expect(a).not.toBeNull();
		expect(a!.stt.url).toBe(`${STT_BASE}/vibe-stt-server-linux-x64.tar.gz`);
		expect(a!.stt.fileName).toBe("vibe-stt-server-linux-x64.tar.gz");
		expect(a!.llama.url).toBe(`${LLAMA_BASE}/llama-b12340-bin-ubuntu-x64.tar.gz`);
		expect(a!.llama.fileName).toBe("llama-b12340-bin-ubuntu-x64.tar.gz");
	});

	it("keeps the shared model URLs for every supported combo", () => {
		const a = resolveAssets("linux", "x64");
		expect(a).not.toBeNull();
		expect(a!.whisperModel.url).toBe(
			"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
		);
		expect(a!.whisperModel.fileName).toBe("ggml-small.bin");
		expect(a!.llmModel.url).toBe(
			"https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
		);
		expect(a!.llmModel.fileName).toBe("Qwen3.5-9B-Q4_K_M.gguf");
	});

	it("returns null for unsupported combos", () => {
		expect(resolveAssets("win32", "arm64")).toBeNull();
		expect(resolveAssets("linux", "arm64")).toBeNull();
		expect(resolveAssets("freebsd", "x64")).toBeNull();
	});
});

describe("local mode settings", () => {
	it("ships local mode defaults", () => {
		expect(DEFAULT_SETTINGS.sttPort).toBe(10000);
		expect(DEFAULT_SETTINGS.llmPort).toBe(8082);
		expect(DEFAULT_SETTINGS.autoStartLocal).toBe(true);
	});

	it("clamps sttPort and llmPort during migration", () => {
		const low = migrateSettings({ sttPort: 80, llmPort: 1 });
		expect(low.sttPort).toBe(1024);
		expect(low.llmPort).toBe(1024);
		const high = migrateSettings({ sttPort: 99999, llmPort: 1e9 });
		expect(high.sttPort).toBe(65535);
		expect(high.llmPort).toBe(65535);
		const bad = migrateSettings({ sttPort: "abc", llmPort: "xyz" });
		expect(bad.sttPort).toBe(DEFAULT_SETTINGS.sttPort);
		expect(bad.llmPort).toBe(DEFAULT_SETTINGS.llmPort);
	});

	it("does not require an api key for the local provider", () => {
		expect(needsApiKey({ ...DEFAULT_SETTINGS, providerId: "local" })).toBe(false);
		expect(needsApiKey({ ...DEFAULT_SETTINGS, providerId: "openai" })).toBe(true);
	});
});
