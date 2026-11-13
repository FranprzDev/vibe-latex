import { spawn, execFile } from "child_process";
import type { ChildProcess } from "child_process";
import { get as httpGet } from "http";
import { get as httpsGet } from "https";
import * as fs from "fs";
import * as path from "path";

export interface LocalModeManagerOptions {
	basePath: string;
	pluginDir: string;
	sttPort: number;
	llmPort: number;
}

export interface LocalStatus {
	installed: boolean;
	running: { stt: boolean; llm: boolean };
	missing: string[];
}

export interface InstallProgress {
	step: string;
	phase: "download" | "extract";
	downloadedBytes: number;
	totalBytes: number | null;
}

export const INSTALL_STEPS = [
	"stt-server",
	"llama-server",
	"whisper-model",
	"llm-model",
] as const;


interface Asset {
	url: string;
	fileName: string;
}

export interface LocalAssets {
	stt: Asset;
	llama: Asset;
	whisperModel: Asset;
	llmModel: Asset;
}

const STT_WINDOWS_X64: Asset = {
	url: "https://github.com/FranprzDev/vibe-latex/releases/latest/download/vibe-stt-server-windows-x64.zip",
	fileName: "vibe-stt-server-windows-x64.zip",
};

const STT_MACOS_ARM64: Asset = {
	url: "https://github.com/FranprzDev/vibe-latex/releases/latest/download/vibe-stt-server-macos-arm64.tar.gz",
	fileName: "vibe-stt-server-macos-arm64.tar.gz",
};

const STT_MACOS_X64: Asset = {
	url: "https://github.com/FranprzDev/vibe-latex/releases/latest/download/vibe-stt-server-macos-x64.tar.gz",
	fileName: "vibe-stt-server-macos-x64.tar.gz",
};

const STT_LINUX_X64: Asset = {
	url: "https://github.com/FranprzDev/vibe-latex/releases/latest/download/vibe-stt-server-linux-x64.tar.gz",
	fileName: "vibe-stt-server-linux-x64.tar.gz",
};

const LLAMA_WIN_X64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-win-vulkan-x64.zip",
	fileName: "llama-b12340-bin-win-vulkan-x64.zip",
};

const LLAMA_MACOS_ARM64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-macos-arm64.tar.gz",
	fileName: "llama-b12340-bin-macos-arm64.tar.gz",
};

const LLAMA_MACOS_X64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-macos-x64.tar.gz",
	fileName: "llama-b12340-bin-macos-x64.tar.gz",
};

const LLAMA_LINUX_X64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-ubuntu-x64.tar.gz",
	fileName: "llama-b12340-bin-ubuntu-x64.tar.gz",
};

const WHISPER_MODEL: Asset = {
	url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
	fileName: "ggml-small.bin",
};

const LLM_MODEL: Asset = {
	url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
	fileName: "Qwen3.5-9B-Q4_K_M.gguf",
};

const STT_ASSETS: Record<string, Asset> = {
	"win32-x64": STT_WINDOWS_X64,
	"darwin-arm64": STT_MACOS_ARM64,
	"darwin-x64": STT_MACOS_X64,
	"linux-x64": STT_LINUX_X64,
};

const LLAMA_ASSETS: Record<string, Asset> = {
	"win32-x64": LLAMA_WIN_X64,
	"darwin-arm64": LLAMA_MACOS_ARM64,
	"darwin-x64": LLAMA_MACOS_X64,
	"linux-x64": LLAMA_LINUX_X64,
};

export function resolveAssets(platform: string, arch: string): LocalAssets | null {
	const key = `${platform}-${arch}`;
	const stt = STT_ASSETS[key];
	const llama = LLAMA_ASSETS[key];
	if (!stt || !llama) return null;
	return { stt, llama, whisperModel: WHISPER_MODEL, llmModel: LLM_MODEL };
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWhisperServer(name: string): boolean {
	return name === "whisper-server" ||
		name === "whisper-server.exe" ||
		name.startsWith("vibe-stt-server-");
}

function isLlamaServer(name: string): boolean {
	return name === "llama-server" || name === "llama-server.exe";
}

async function findFile(root: string, match: (name: string) => boolean): Promise<string | null> {
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(root, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const entry of entries) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) {
			const found = await findFile(full, match);
			if (found) return found;
		} else if (entry.isFile() && match(entry.name)) {
			return full;
		}
	}
	return null;
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.promises.access(file);
		return true;
	} catch {
		return false;
	}
}

function runTar(archive: string, destDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile("tar", ["-xf", archive, "-C", destDir], (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

export class LocalModeManager {
	private sttProcess: ChildProcess | null = null;
	private llmProcess: ChildProcess | null = null;
	private sttPort: number;
	private llmPort: number;
	private localRoot: string;
	private sttDir: string;
	private llamaDir: string;
	private modelsDir: string;

	constructor(options: LocalModeManagerOptions) {
		this.sttPort = options.sttPort;
		this.llmPort = options.llmPort;
		this.localRoot = path.join(options.basePath, options.pluginDir, "local");
		this.sttDir = path.join(this.localRoot, "bin", "stt");
		this.llamaDir = path.join(this.localRoot, "bin", "llama");
		this.modelsDir = path.join(this.localRoot, "models");
	}

	private isAlive(child: ChildProcess | null): boolean {
		return !!child && child.exitCode === null && child.signalCode === null;
	}

	async status(): Promise<LocalStatus> {
		const missing: string[] = [];
		const sttBin = await findFile(this.sttDir, isWhisperServer);
		if (!sttBin) missing.push("stt-server");
		const llamaBin = await findFile(this.llamaDir, isLlamaServer);
		if (!llamaBin) missing.push("llama-server");
		if (!(await exists(path.join(this.modelsDir, WHISPER_MODEL.fileName)))) {
			missing.push("whisper-model");
		}
		if (!(await exists(path.join(this.modelsDir, LLM_MODEL.fileName)))) {
			missing.push("llm-model");
		}
		return {
			installed: missing.length === 0,
			running: { stt: this.isAlive(this.sttProcess), llm: this.isAlive(this.llmProcess) },
			missing,
		};
	}

	private download(
		step: string,
		asset: Asset,
		tmpDir: string,
		onProgress?: (p: InstallProgress) => void,
	): Promise<string> {
		const dest = path.join(tmpDir, asset.fileName);
		return new Promise<string>((resolve, reject) => {
			void fs.promises.open(dest, "w").then((handle) => {
				let downloadedBytes = 0;
				let settled = false;
				let writeChain: Promise<unknown> = Promise.resolve();

				const fail = (error: Error) => {
					if (settled) return;
					settled = true;
					writeChain
						.catch(() => undefined)
						.then(() => handle.close())
						.catch(() => undefined)
						.then(() => reject(error));
				};

				const request = (url: string, redirects: number) => {
					const getter = (url.startsWith("http:") ? httpGet : httpsGet) as typeof httpsGet;
					const req = getter(url, (res) => {
						const status = res.statusCode ?? 0;
						const location = res.headers.location;
						if (status >= 300 && status < 400 && location && redirects < 5) {
							res.resume();
							request(new URL(location, url).toString(), redirects + 1);
							return;
						}
						if (status !== 200) {
							res.resume();
							fail(new Error(`descarga de ${step} falló (HTTP ${status})`));
							return;
						}
						const rawHeader = res.headers["content-length"];
						const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
						const parsed = header === undefined ? NaN : Number(header);
						const totalBytes = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

						res.on("data", (chunk: Buffer) => {
							downloadedBytes += chunk.length;
							writeChain = writeChain.then(() => handle.write(chunk));
							onProgress?.({ step, phase: "download", downloadedBytes, totalBytes });
						});
						res.on("end", () => {
							writeChain
								.then(() => handle.close())
								.then(() => {
									if (settled) return;
									settled = true;
									resolve(dest);
								})
								.catch((error) =>
									fail(error instanceof Error ? error : new Error(String(error))),
								);
						});
						res.on("error", (error) => fail(error));
					});
					req.setTimeout(60_000, () =>
						req.destroy(new Error("tiempo de espera agotado")),
					);
					req.on("error", (error) => fail(error));
				};

				request(asset.url, 0);
			}).catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
		});
	}

	async install(
		onProgress?: (p: InstallProgress) => void,
		assetsOverride?: LocalAssets,
	): Promise<void> {
		const tmpDir = path.join(this.localRoot, "tmp");
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
		const assets = assetsOverride ?? resolveAssets(process.platform, process.arch);
		if (!assets) {
			throw new Error(`Plataforma no soportada: ${process.platform}/${process.arch}`);
		}
		await fs.promises.mkdir(tmpDir, { recursive: true });
		await fs.promises.mkdir(this.modelsDir, { recursive: true });

		let step = "stt-server";
		try {
			step = "stt-server";
			const sttArchive = await this.download(step, assets.stt, tmpDir, onProgress);
			await fs.promises.mkdir(this.sttDir, { recursive: true });
			onProgress?.({ step, phase: "extract", downloadedBytes: 0, totalBytes: null });
			await runTar(sttArchive, this.sttDir);

			step = "llama-server";
			const llamaArchive = await this.download(step, assets.llama, tmpDir, onProgress);
			await fs.promises.mkdir(this.llamaDir, { recursive: true });
			onProgress?.({ step, phase: "extract", downloadedBytes: 0, totalBytes: null });
			await runTar(llamaArchive, this.llamaDir);

			step = "whisper-model";
			const whisperFile = await this.download(step, assets.whisperModel, tmpDir, onProgress);
			await fs.promises.rename(whisperFile, path.join(this.modelsDir, assets.whisperModel.fileName));

			step = "llm-model";
			const llmFile = await this.download(step, assets.llmModel, tmpDir, onProgress);
			await fs.promises.rename(llmFile, path.join(this.modelsDir, assets.llmModel.fileName));

			if (process.platform !== "win32") {
				const sttBin = await findFile(this.sttDir, isWhisperServer);
				if (sttBin) await fs.promises.chmod(sttBin, 0o755);
				const llamaBin = await findFile(this.llamaDir, isLlamaServer);
				if (llamaBin) await fs.promises.chmod(llamaBin, 0o755);
			}
		} catch (error) {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
			if (!(await exists(path.join(this.modelsDir, assets.whisperModel.fileName))) ||
				!(await exists(path.join(this.modelsDir, assets.llmModel.fileName)))) {
				await fs.promises.rm(path.join(this.localRoot, "bin"), { recursive: true, force: true });
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`No se pudo instalar el modo local (${step}): ${message}`);
		}
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	}

	private async waitForStt(): Promise<void> {
		const deadline = Date.now() + 90_000;
		while (Date.now() < deadline) {
			try {
				await fetch(`http://127.0.0.1:${this.sttPort}/`, {
					signal: AbortSignal.timeout(3_000),
				});
				return;
			} catch {
				await delay(1_000);
			}
		}
		throw new Error("whisper.cpp no respondió a tiempo.");
	}

	private async waitForLlm(): Promise<void> {
		const deadline = Date.now() + 180_000;
		while (Date.now() < deadline) {
			try {
				const res = await fetch(`http://127.0.0.1:${this.llmPort}/health`, {
					signal: AbortSignal.timeout(3_000),
				});
				if (res.status === 200) return;
			} catch {}
			await delay(2_000);
		}
		throw new Error("llama-server no respondió a tiempo.");
	}

	async start(): Promise<void> {
		if (this.isAlive(this.sttProcess) && this.isAlive(this.llmProcess)) return;

		const sttBin = await findFile(this.sttDir, isWhisperServer);
		const llamaBin = await findFile(this.llamaDir, isLlamaServer);
		if (!sttBin || !llamaBin) {
			throw new Error("El modo local no está instalado por completo.");
		}
		const whisperModelPath = path.join(this.modelsDir, WHISPER_MODEL.fileName);
		const llmModelPath = path.join(this.modelsDir, LLM_MODEL.fileName);

		const started: ChildProcess[] = [];
		try {
			if (!this.isAlive(this.sttProcess)) {
				const child = spawn(sttBin, [
					"-m", whisperModelPath,
					"--host", "127.0.0.1",
					"--port", String(this.sttPort),
				], { detached: false, stdio: "ignore" });
				child.on("exit", () => {
					if (this.sttProcess === child) this.sttProcess = null;
				});
				this.sttProcess = child;
				started.push(child);
			}
			if (!this.isAlive(this.llmProcess)) {
				const child = spawn(llamaBin, [
					"-m", llmModelPath,
					"--alias", "qwen3.5-9b",
					"--host", "127.0.0.1",
					"--port", String(this.llmPort),
					"-c", "8192",
				], { detached: false, stdio: "ignore" });
				child.on("exit", () => {
					if (this.llmProcess === child) this.llmProcess = null;
				});
				this.llmProcess = child;
				started.push(child);
			}
			await this.waitForStt();
			await this.waitForLlm();
		} catch (error) {
			for (const child of started) child.kill("SIGKILL");
			throw error;
		}
	}

	private async terminate(child: ChildProcess | null): Promise<void> {
		if (!child || child.exitCode !== null || child.signalCode !== null) return;
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		child.kill("SIGTERM");
		const outcome = await Promise.race([
			exited.then(() => "exit" as const),
			delay(5_000).then(() => "timeout" as const),
		]);
		if (outcome === "timeout" && child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
			await Promise.race([exited, delay(2_000)]);
		}
	}

	async stop(): Promise<void> {
		const children = [this.sttProcess, this.llmProcess];
		this.sttProcess = null;
		this.llmProcess = null;
		await Promise.all(children.map((child) => this.terminate(child)));
	}

	async uninstall(): Promise<void> {
		await this.stop();
		await fs.promises.rm(this.localRoot, { recursive: true, force: true });
	}

	async updatePorts(sttPort: number, llmPort: number): Promise<void> {
		const wasRunning = this.isAlive(this.sttProcess) || this.isAlive(this.llmProcess);
		this.sttPort = sttPort;
		this.llmPort = llmPort;
		if (wasRunning) {
			await this.stop();
			await this.start();
		}
	}
}
