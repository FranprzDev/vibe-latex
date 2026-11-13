import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
	candidateBinDirs,
	candidateModelDirs,
	findExecutable,
	findModel,
	DetectEnvironment,
} from "../src/local/detect";
import { LocalModeManager } from "../src/local/manager";
import { vi } from "vitest";

vi.mock("obsidian", () => ({
	Notice: class {
		constructor(_message: string) {}
	},
}));

const winEnv: DetectEnvironment = {
	platform: "win32",
	pathEnv: "C:\\Windows\\system32;D\\tools\\llama",
	home: "C:\\Users\\fran",
	localAppData: "C:\\Users\\fran\\AppData\\Local",
	programFiles: "C:\\Program Files",
};

const linuxEnv: DetectEnvironment = {
	platform: "linux",
	pathEnv: "/home/fran/bin:/usr/bin",
	home: "/home/fran",
	localAppData: "",
	programFiles: "",
};

describe("candidateBinDirs", () => {
	it("includes PATH and common Windows install dirs on win32", () => {
		const dirs = candidateBinDirs(winEnv);
		expect(dirs).toContain("D\\tools\\llama");
		expect(dirs).toContain(path.join("C:\\Program Files", "llama.cpp"));
		expect(dirs).toContain(path.join("C:\\Program Files", "whisper.cpp"));
		expect(dirs).toContain(path.join("C:\\Users\\fran\\AppData\\Local", "Programs", "llama"));
	});

	it("includes PATH and unix dirs elsewhere", () => {
		const dirs = candidateBinDirs(linuxEnv);
		expect(dirs).toContain("/home/fran/bin");
		expect(dirs).toContain("/usr/local/bin");
		expect(dirs).toContain("/home/fran/.local/bin");
	});
});

describe("findExecutable / findModel", () => {
	it("finds a binary by name in the first dir that has it", async () => {
		const exists = async (p: string) => p === "/usr/bin/llama-server";
		expect(await findExecutable(["/bin", "/usr/bin"], ["llama-server"], exists)).toBe("/usr/bin/llama-server");
	});

	it("returns null when nothing matches", async () => {
		expect(await findExecutable(["/bin"], ["llama-server"], async () => false)).toBeNull();
	});

	it("finds a model file in candidate dirs", async () => {
		const dirs = candidateModelDirs(linuxEnv, ["/opt/bin"]);
		expect(dirs).toContain("/home/fran/.cache/whisper");
		const exists = async (p: string) => p === "/opt/bin/ggml-small.bin";
		expect(await findModel(dirs, "ggml-small.bin", exists)).toBe("/opt/bin/ggml-small.bin");
	});
});

describe("manager with existing installs", () => {
	function tmpRoot(): string {
		return fs.mkdtempSync(path.join(os.tmpdir(), "vibe-detect-"));
	}

	it("honors manual paths instead of reporting missing", async () => {
		const root = tmpRoot();
		const ext = path.join(root, "ext");
		fs.mkdirSync(ext, { recursive: true });
		for (const f of ["whisper-server", "llama-server", "ggml-small.bin", "Qwen3.5-9B-Q4_K_M.gguf"]) {
			fs.writeFileSync(path.join(ext, f), "x");
		}
		const mgr = new LocalModeManager({
			basePath: path.join(root, "vault"),
			pluginDir: ".obsidian/plugins/vibe-latex",
			sttPort: 10000,
			llmPort: 8082,
			llmApiKey: "k",
			paths: {
				whisperServerPath: path.join(ext, "whisper-server"),
				llamaServerPath: path.join(ext, "llama-server"),
				whisperModelPath: path.join(ext, "ggml-small.bin"),
				llmModelPath: path.join(ext, "Qwen3.5-9B-Q4_K_M.gguf"),
			},
		});
		const status = await mgr.status();
		expect(status.missing).toEqual([]);
		expect(status.installed).toBe(true);
	});

	it("detects binaries and models on PATH", async () => {
		const root = tmpRoot();
		const binDir = path.join(root, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		for (const f of ["whisper-server", "llama-server", "ggml-small.bin", "Qwen3.5-9B-Q4_K_M.gguf"]) {
			fs.writeFileSync(path.join(binDir, f), "x");
		}
		const oldPath = process.env.PATH;
		process.env.PATH = binDir;
		try {
			const mgr = new LocalModeManager({
				basePath: path.join(root, "vault"),
				pluginDir: ".obsidian/plugins/vibe-latex",
				sttPort: 10000,
				llmPort: 8082,
				llmApiKey: "k",
			});
			const status = await mgr.status();
			expect(status.missing).toEqual([]);
		} finally {
			process.env.PATH = oldPath;
		}
	});
});
