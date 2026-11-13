import { describe, it, expect, vi } from "vitest";
import { createServer } from "http";
import type { Server } from "http";
import type { AddressInfo } from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
	buildLlamaArgs,
	buildSttArgs,
	buildVlArgs,
	INSTALL_STEPS,
	LocalModeManager,
	resolveAssets,
} from "../src/local/manager";
import type { InstallProgress, LocalAssets } from "../src/local/manager";
import { DEFAULT_SETTINGS, migrateSettings, needsApiKey } from "../src/settings";

vi.mock("child_process", () => ({
	spawn: vi.fn(),
	execFile: vi.fn(
		(_file: string, _args: string[], callback: (error: Error | null) => void) => {
			callback(null);
		},
	),
}));

vi.mock("obsidian", () => ({
	Notice: class {
		constructor(_message: string) {}
	},
}));

const STT_BASE = "https://github.com/FranprzDev/vibe-stt-server/releases/download/stt-v1.9.5";
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

function startServer(): Promise<{ server: Server; port: number; hits: string[] }> {
	return new Promise((resolve) => {
		const hits: string[] = [];
		const server = createServer((req, res) => {
			hits.push(req.url ?? "");
			if (req.url?.startsWith("/redirect")) {
				res.writeHead(302, { Location: "/file" });
				res.end();
				return;
			}
			res.writeHead(200, { "Content-Length": "6" });
			res.write("abc");
			setTimeout(() => res.end("def"), 20);
		});
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, port: (server.address() as AddressInfo).port, hits });
		});
	});
}

function assetsFor(base: string): LocalAssets {
	return {
		stt: { url: `${base}/redirect`, fileName: "stt.tar.gz" },
		llama: { url: `${base}/redirect`, fileName: "llama.tar.gz" },
		whisperModel: { url: `${base}/file`, fileName: "ggml-small.bin" },
		llmModel: { url: `${base}/file`, fileName: "model.gguf" },
	};
}

describe("LocalModeManager.install", () => {
	it("follows redirects, writes bytes, and reports phases in order", async () => {
		const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-latex-"));
		const { server, port, hits } = await startServer();
		const base = `http://127.0.0.1:${port}`;
		try {
			const manager = new LocalModeManager({
				basePath,
				pluginDir: "vibe-latex",
				sttPort: 10000,
				llmPort: 8082,
				llmApiKey: "test-key",
			});
			const events: InstallProgress[] = [];
			await manager.install((p) => events.push({ ...p }), assetsFor(base));

			const downloads = events.filter((e) => e.phase === "download");
			const seen: string[] = [];
			for (const event of downloads) {
				if (seen[seen.length - 1] !== event.step) seen.push(event.step);
			}
			expect(seen).toEqual([...INSTALL_STEPS]);

			for (const step of INSTALL_STEPS) {
				const bytes = downloads
					.filter((e) => e.step === step)
					.map((e) => e.downloadedBytes);
				expect(bytes.length).toBeGreaterThan(0);
				for (let i = 1; i < bytes.length; i++) {
					expect(bytes[i]).toBeGreaterThan(bytes[i - 1]);
				}
				expect(bytes[bytes.length - 1]).toBe(6);
			}

			expect(events.filter((e) => e.phase === "extract").map((e) => e.step)).toEqual([
				"stt-server",
				"llama-server",
			]);
			for (const step of ["stt-server", "llama-server"]) {
				const extractIndex = events.findIndex((e) => e.step === step && e.phase === "extract");
				const lastDownloadIndex = events.reduce(
					(acc, e, i) => (e.step === step && e.phase === "download" ? i : acc),
					-1,
				);
				expect(extractIndex).toBeGreaterThan(lastDownloadIndex);
			}

			expect(hits.filter((h) => h === "/redirect").length).toBe(2);
			expect(hits.filter((h) => h === "/file").length).toBe(4);

			const modelsDir = path.join(basePath, "vibe-latex", "local", "models");
			expect(await fs.promises.readFile(path.join(modelsDir, "ggml-small.bin"), "utf8")).toBe(
				"abcdef",
			);
			expect(await fs.promises.readFile(path.join(modelsDir, "model.gguf"), "utf8")).toBe(
				"abcdef",
			);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await fs.promises.rm(basePath, { recursive: true, force: true });
		}
	});

	it("rejects a download that fails the integrity check and removes the file", async () => {
		const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-latex-"));
		const { server, port } = await startServer();
		const base = `http://127.0.0.1:${port}`;
		try {
			const manager = new LocalModeManager({
				basePath,
				pluginDir: "vibe-latex",
				sttPort: 10000,
				llmPort: 8082,
				llmApiKey: "test-key",
			});
			const assets: LocalAssets = {
				stt: { url: `${base}/file`, fileName: "stt.tar.gz", sha256: "0".repeat(64) },
				llama: { url: `${base}/file`, fileName: "llama.tar.gz" },
				whisperModel: { url: `${base}/file`, fileName: "ggml-small.bin" },
				llmModel: { url: `${base}/file`, fileName: "model.gguf" },
			};
			await expect(manager.install(undefined, assets)).rejects.toThrow(
				"no pasó la verificación de integridad",
			);
			const partial = path.join(basePath, "vibe-latex", "local", "tmp", "stt.tar.gz");
			expect(fs.existsSync(partial)).toBe(false);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await fs.promises.rm(basePath, { recursive: true, force: true });
		}
	});

	it("rejects an http URL to a remote host", async () => {
		const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-latex-"));
		try {
			const manager = new LocalModeManager({
				basePath,
				pluginDir: "vibe-latex",
				sttPort: 10000,
				llmPort: 8082,
				llmApiKey: "test-key",
			});
			const assets: LocalAssets = {
				stt: { url: "http://example.com/stt.tar.gz", fileName: "stt.tar.gz" },
				llama: { url: "http://example.com/llama.tar.gz", fileName: "llama.tar.gz" },
				whisperModel: { url: "http://example.com/ggml-small.bin", fileName: "ggml-small.bin" },
				llmModel: { url: "http://example.com/model.gguf", fileName: "model.gguf" },
			};
			await expect(manager.install(undefined, assets)).rejects.toThrow(
				"URL de descarga no permitida: http://example.com/stt.tar.gz",
			);
		} finally {
			await fs.promises.rm(basePath, { recursive: true, force: true });
		}
	});
});

describe("LocalModeManager.ready", () => {
	it("reports both servers ready when they respond", async () => {
		const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-latex-"));
		const { server, port } = await startServer();
		try {
			const manager = new LocalModeManager({
				basePath,
				pluginDir: "vibe-latex",
				sttPort: port,
				llmPort: port,
				llmApiKey: "test-key",
			});
			expect(await manager.ready()).toEqual({ stt: true, llm: true });
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await fs.promises.rm(basePath, { recursive: true, force: true });
		}
	});

	it("reports a server that does not respond as not ready", async () => {
		const basePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibe-latex-"));
		const { server, port } = await startServer();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		try {
			const manager = new LocalModeManager({
				basePath,
				pluginDir: "vibe-latex",
				sttPort: port,
				llmPort: port,
				llmApiKey: "test-key",
			});
			expect(await manager.ready()).toEqual({ stt: false, llm: false });
		} finally {
			await fs.promises.rm(basePath, { recursive: true, force: true });
		}
	});
});

describe("spawn arguments", () => {
	it("builds the whisper.cpp arguments", () => {
		expect(buildSttArgs("/models/ggml-small.bin", 10000)).toEqual([
			"-m", "/models/ggml-small.bin",
			"--host", "127.0.0.1",
			"--port", "10000",
		]);
	});

	it("builds the llama.cpp arguments with the api key and 4096 context", () => {
		const args = buildLlamaArgs("/models/model.gguf", 8082, "secret");
		expect(args).toContain("--api-key");
		expect(args[args.indexOf("--api-key") + 1]).toBe("secret");
		expect(args).toContain("-c");
		expect(args[args.indexOf("-c") + 1]).toBe("4096");
		expect(args).toEqual([
			"-m", "/models/model.gguf",
			"--alias", "qwen3.5-9b",
			"--host", "127.0.0.1",
			"--port", "8082",
			"--api-key", "secret",
			"-c", "4096",
		]);
	});

	it("builds the llama.cpp vision arguments with the mmproj and jinja", () => {
		expect(buildVlArgs("/models/vl.gguf", "/models/mmproj.gguf", 8083, "secret")).toEqual([
			"-m", "/models/vl.gguf",
			"--mmproj", "/models/mmproj.gguf",
			"--alias", "lfm-vl",
			"--host", "127.0.0.1",
			"--port", "8083",
			"--api-key", "secret",
			"-c", "4096",
			"--jinja",
		]);
	});
});

