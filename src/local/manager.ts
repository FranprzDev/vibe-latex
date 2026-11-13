import { spawn, execFile } from "child_process";
import type { ChildProcess } from "child_process";
import { createHash } from "crypto";
import { get as httpGet } from "http";
import { get as httpsGet } from "https";
import { Notice } from "obsidian";
import * as fs from "fs";
import * as path from "path";
import {
	candidateBinDirs,
	candidateModelDirs,
	currentEnvironment,
	findExecutable,
	findModel,
} from "./detect";

export interface LocalModeManagerOptions {
	basePath: string;
	pluginDir: string;
	sttPort: number;
	llmPort: number;
	llmApiKey: string;
	paths?: Partial<ExternalPaths>;
}

export interface ExternalPaths {
	whisperServerPath: string;
	llamaServerPath: string;
	whisperModelPath: string;
	llmModelPath: string;
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
	sha256?: string;
}

export interface LocalAssets {
	stt: Asset;
	llama: Asset;
	whisperModel: Asset;
	llmModel: Asset;
}

const STT_WINDOWS_X64: Asset = {
	url: "https://github.com/FranprzDev/vibe-stt-server/releases/download/stt-v1.9.5/vibe-stt-server-windows-x64.zip",
	fileName: "vibe-stt-server-windows-x64.zip",
	sha256: "6ae141da58e7599df38273a72b6e5904f35424a34a7224ef311cdec388b9d270",
};

const STT_MACOS_ARM64: Asset = {
	url: "https://github.com/FranprzDev/vibe-stt-server/releases/download/stt-v1.9.5/vibe-stt-server-macos-arm64.tar.gz",
	fileName: "vibe-stt-server-macos-arm64.tar.gz",
	sha256: "611181cf253209d633691a08a182b6b93b4ce9d8444509e4b53ab6f1a7468232",
};

const STT_MACOS_X64: Asset = {
	url: "https://github.com/FranprzDev/vibe-stt-server/releases/download/stt-v1.9.5/vibe-stt-server-macos-x64.tar.gz",
	fileName: "vibe-stt-server-macos-x64.tar.gz",
	sha256: "d01e1b62ad589b50d4f3cbeffb6e49e586f00516e1660d9e3dcc7a82b6ca45c8",
};

const STT_LINUX_X64: Asset = {
	url: "https://github.com/FranprzDev/vibe-stt-server/releases/download/stt-v1.9.5/vibe-stt-server-linux-x64.tar.gz",
	fileName: "vibe-stt-server-linux-x64.tar.gz",
	sha256: "f5d1291b27792fdd396b92b03e9d0c399e01cfdf1af78cc2bac64dbdc868ba62",
};

const LLAMA_WIN_X64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-win-vulkan-x64.zip",
	fileName: "llama-b12340-bin-win-vulkan-x64.zip",
	sha256: "a2c7a2bfaaf57b5357f84cf584603d088143a5be08c68cb623e6d9bb7db664e8",
};

const LLAMA_MACOS_ARM64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-macos-arm64.tar.gz",
	fileName: "llama-b12340-bin-macos-arm64.tar.gz",
	sha256: "f4414a7224a2fef9e785c8673f0574be78aa914652099b40ef66890f7474e686",
};

const LLAMA_MACOS_X64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-macos-x64.tar.gz",
	fileName: "llama-b12340-bin-macos-x64.tar.gz",
	sha256: "f1e83a37961e69e3468244fa95c98a11f1cdd8f454a4a2bdb094c36c53b4a2ba",
};

const LLAMA_LINUX_X64: Asset = {
	url: "https://github.com/ggml-org/llama.cpp/releases/download/b12340/llama-b12340-bin-ubuntu-x64.tar.gz",
	fileName: "llama-b12340-bin-ubuntu-x64.tar.gz",
	sha256: "5bc0276548147e56aa03f97b201b1cb3b43cbda6e388f1f2f4c8d82b56313856",
};

const WHISPER_MODEL: Asset = {
	url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
	fileName: "ggml-small.bin",
	sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
};

const LLM_MODEL: Asset = {
	url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
	fileName: "Qwen3.5-9B-Q4_K_M.gguf",
	sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
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

export function buildSttArgs(modelPath: string, port: number): string[] {
	return [
		"-m", modelPath,
		"--host", "127.0.0.1",
		"--port", String(port),
	];
}

export function buildLlamaArgs(modelPath: string, port: number, apiKey: string): string[] {
	return [
		"-m", modelPath,
		"--alias", "qwen3.5-9b",
		"--host", "127.0.0.1",
		"--port", String(port),
		"--api-key", apiKey,
		"-c", "4096",
	];
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAllowedDownloadUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol === "https:") return true;
	return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
}

function hashFile(file: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = fs.createReadStream(file);
		stream.on("error", reject);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
	});
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
	private llmApiKey: string;
	private localRoot: string;
	private sttDir: string;
	private llamaDir: string;
	private modelsDir: string;
	private logsDir: string;
	private externalPaths: ExternalPaths;

	constructor(options: LocalModeManagerOptions) {
		this.externalPaths = {
			whisperServerPath: options.paths?.whisperServerPath ?? "",
			llamaServerPath: options.paths?.llamaServerPath ?? "",
			whisperModelPath: options.paths?.whisperModelPath ?? "",
			llmModelPath: options.paths?.llmModelPath ?? "",
		};
		this.sttPort = options.sttPort;
		this.llmPort = options.llmPort;
		this.llmApiKey = options.llmApiKey;
		this.localRoot = path.join(options.basePath, options.pluginDir, "local");
		this.sttDir = path.join(this.localRoot, "bin", "stt");
		this.llamaDir = path.join(this.localRoot, "bin", "llama");
		this.modelsDir = path.join(this.localRoot, "models");
		this.logsDir = path.join(this.localRoot, "logs");
	}

	private isAlive(child: ChildProcess | null): boolean {
		return !!child && child.exitCode === null && child.signalCode === null;
	}

	private async resolveSttBinary(): Promise<string | null> {
		const manual = this.externalPaths.whisperServerPath;
		if (manual && (await exists(manual))) return manual;
		const local = await findFile(this.sttDir, isWhisperServer);
		if (local) return local;
		return findExecutable(candidateBinDirs(currentEnvironment()), [
			"whisper-server",
			"whisper-server.exe",
		]);
	}

	private async resolveLlamaBinary(): Promise<string | null> {
		const manual = this.externalPaths.llamaServerPath;
		if (manual && (await exists(manual))) return manual;
		const local = await findFile(this.llamaDir, isLlamaServer);
		if (local) return local;
		return findExecutable(candidateBinDirs(currentEnvironment()), [
			"llama-server",
			"llama-server.exe",
		]);
	}

	private async modelSearchDirs(): Promise<string[]> {
		const env = currentEnvironment();
		const bins = [await this.resolveSttBinary(), await this.resolveLlamaBinary()];
		const binDirs = bins.filter((b): b is string => !!b).map((b) => path.dirname(b));
		return candidateModelDirs(env, [...binDirs, this.modelsDir]);
	}

	private async resolveWhisperModel(): Promise<string | null> {
		const manual = this.externalPaths.whisperModelPath;
		if (manual && (await exists(manual))) return manual;
		return findModel(await this.modelSearchDirs(), WHISPER_MODEL.fileName);
	}

	private async resolveLlmModel(): Promise<string | null> {
		const manual = this.externalPaths.llmModelPath;
		if (manual && (await exists(manual))) return manual;
		return findModel(await this.modelSearchDirs(), LLM_MODEL.fileName);
	}

	async status(): Promise<LocalStatus> {
		const missing: string[] = [];
		if (!(await this.resolveSttBinary())) missing.push("stt-server");
		if (!(await this.resolveLlamaBinary())) missing.push("llama-server");
		if (!(await this.resolveWhisperModel())) {
			missing.push("whisper-model");
		}
		if (!(await this.resolveLlmModel())) {
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
					if (!isAllowedDownloadUrl(url)) {
						fail(new Error(`URL de descarga no permitida: ${url}`));
						return;
					}
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
								.then(async () => {
									if (settled) return;
									if (asset.sha256) {
										const actual = await hashFile(dest);
										if (actual !== asset.sha256) {
											await fs.promises.rm(dest, { force: true });
											fail(new Error(
												`la descarga de ${step} no pasó la verificación de integridad`,
											));
											return;
										}
									}
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
			if (!(await this.resolveSttBinary())) {
				step = "stt-server";
				const sttArchive = await this.download(step, assets.stt, tmpDir, onProgress);
				await fs.promises.mkdir(this.sttDir, { recursive: true });
				onProgress?.({ step, phase: "extract", downloadedBytes: 0, totalBytes: null });
				await runTar(sttArchive, this.sttDir);
			}

			if (!(await this.resolveLlamaBinary())) {
				step = "llama-server";
				const llamaArchive = await this.download(step, assets.llama, tmpDir, onProgress);
				await fs.promises.mkdir(this.llamaDir, { recursive: true });
				onProgress?.({ step, phase: "extract", downloadedBytes: 0, totalBytes: null });
				await runTar(llamaArchive, this.llamaDir);
			}

			if (!(await this.resolveWhisperModel())) {
				step = "whisper-model";
				const whisperFile = await this.download(step, assets.whisperModel, tmpDir, onProgress);
				await fs.promises.rename(whisperFile, path.join(this.modelsDir, assets.whisperModel.fileName));
			}

			if (!(await this.resolveLlmModel())) {
				step = "llm-model";
				const llmFile = await this.download(step, assets.llmModel, tmpDir, onProgress);
				await fs.promises.rename(llmFile, path.join(this.modelsDir, assets.llmModel.fileName));
			}

			if (process.platform !== "win32") {
				const sttBin = await findFile(this.sttDir, isWhisperServer);
				if (sttBin) await fs.promises.chmod(sttBin, 0o755);
				const llamaBin = await findFile(this.llamaDir, isLlamaServer);
				if (llamaBin) await fs.promises.chmod(llamaBin, 0o755);
			}
		} catch (error) {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
			if (!(await this.resolveWhisperModel()) || !(await this.resolveLlmModel())) {
				await fs.promises.rm(path.join(this.localRoot, "bin"), { recursive: true, force: true });
			}
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`No se pudo instalar el modo local (${step}): ${message}`);
		}
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	}

	private get sttHealthUrl(): string {
		return `http://127.0.0.1:${this.sttPort}/`;
	}

	private get llmHealthUrl(): string {
		return `http://127.0.0.1:${this.llmPort}/health`;
	}

	private async ping(url: string, requireOk: boolean): Promise<boolean> {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
			return requireOk ? res.status === 200 : true;
		} catch {
			return false;
		}
	}

	async ready(): Promise<{ stt: boolean; llm: boolean }> {
		const [stt, llm] = await Promise.all([
			this.ping(this.sttHealthUrl, false),
			this.ping(this.llmHealthUrl, true),
		]);
		return { stt, llm };
	}

	private async waitForStt(): Promise<void> {
		const deadline = Date.now() + 90_000;
		while (Date.now() < deadline) {
			if (await this.ping(this.sttHealthUrl, false)) return;
			await delay(1_000);
		}
		throw new Error("whisper.cpp no respondió a tiempo.");
	}

	private async waitForLlm(): Promise<void> {
		const deadline = Date.now() + 180_000;
		while (Date.now() < deadline) {
			if (await this.ping(this.llmHealthUrl, true)) return;
			await delay(2_000);
		}
		throw new Error("llama-server no respondió a tiempo.");
	}

	private logPath(server: "stt" | "llm"): string {
		return path.join(this.logsDir, server === "stt" ? "stt-server.log" : "llama-server.log");
	}

	private spawnServer(server: "stt" | "llm", bin: string, args: string[]): ChildProcess {
		const logPath = this.logPath(server);
		const logStream = fs.createWriteStream(logPath, { flags: "a" });
		const child = spawn(bin, args, {
			detached: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout?.pipe(logStream, { end: false });
		child.stderr?.pipe(logStream, { end: false });
		child.on("exit", () => {
			logStream.end();
			const tracked = server === "stt" ? this.sttProcess : this.llmProcess;
			if (tracked !== child) return;
			if (server === "stt") this.sttProcess = null;
			else this.llmProcess = null;
			const label = server === "stt" ? "servidor de voz" : "servidor de conversión";
			new Notice(`Vibe LaTeX: el ${label} se detuvo. Revisá el registro: ${logPath}`);
		});
		return child;
	}

	async start(): Promise<void> {
		if (this.isAlive(this.sttProcess) && this.isAlive(this.llmProcess)) return;

		const sttBin = await this.resolveSttBinary();
		const llamaBin = await this.resolveLlamaBinary();
		const whisperModelPath = await this.resolveWhisperModel();
		const llmModelPath = await this.resolveLlmModel();
		if (!sttBin || !llamaBin || !whisperModelPath || !llmModelPath) {
			throw new Error("El modo local no está instalado por completo.");
		}

		await fs.promises.mkdir(this.logsDir, { recursive: true });

		const started: ChildProcess[] = [];
		try {
			if (!this.isAlive(this.sttProcess)) {
				const child = this.spawnServer(
					"stt",
					sttBin,
					buildSttArgs(whisperModelPath, this.sttPort),
				);
				this.sttProcess = child;
				started.push(child);
			}
			if (!this.isAlive(this.llmProcess)) {
				const child = this.spawnServer(
					"llm",
					llamaBin,
					buildLlamaArgs(llmModelPath, this.llmPort, this.llmApiKey),
				);
				this.llmProcess = child;
				started.push(child);
			}
			await Promise.all([this.waitForStt(), this.waitForLlm()]);
		} catch (error) {
			if (this.sttProcess && started.includes(this.sttProcess)) this.sttProcess = null;
			if (this.llmProcess && started.includes(this.llmProcess)) this.llmProcess = null;
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
