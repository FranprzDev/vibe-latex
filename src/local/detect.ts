import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface DetectEnvironment {
	platform: NodeJS.Platform;
	pathEnv: string;
	home: string;
	localAppData: string;
	programFiles: string;
}

export function currentEnvironment(): DetectEnvironment {
	return {
		platform: process.platform,
		pathEnv: process.env.PATH ?? "",
		home: os.homedir(),
		localAppData: process.env.LOCALAPPDATA ?? "",
		programFiles: process.env.ProgramFiles ?? "C:\\Program Files",
	};
}

export function candidateBinDirs(env: DetectEnvironment): string[] {
	const delim = env.platform === "win32" ? ";" : ":";
	const dirs = env.pathEnv.split(delim).filter((d) => d.length > 0);
	if (env.platform === "win32") {
		const roots = [env.programFiles];
		if (env.localAppData) roots.push(path.join(env.localAppData, "Programs"));
		for (const root of roots) {
			dirs.push(
				path.join(root, "llama.cpp"),
				path.join(root, "llama"),
				path.join(root, "whisper.cpp"),
				path.join(root, "whisper"),
			);
		}
		dirs.push("C:\\llama.cpp", "C:\\whisper.cpp");
	} else {
		dirs.push(
			"/usr/local/bin",
			"/usr/bin",
			"/opt/homebrew/bin",
			path.join(env.home, ".local", "bin"),
		);
	}
	return [...new Set(dirs)];
}

export function candidateModelDirs(env: DetectEnvironment, extraDirs: string[]): string[] {
	const dirs = [...extraDirs];
	dirs.push(
		path.join(env.home, ".cache", "whisper"),
		path.join(env.home, ".cache", "llama.cpp"),
		path.join(env.home, "models"),
		path.join(env.home, "Models"),
	);
	if (env.platform === "win32") dirs.push("C:\\models");
	else dirs.push("/usr/local/share/models");
	return [...new Set(dirs)];
}

type ExistsFn = (file: string) => Promise<boolean>;

const realExists: ExistsFn = async (file) => {
	try {
		await fs.promises.access(file);
		return true;
	} catch {
		return false;
	}
};

export async function findExecutable(
	dirs: string[],
	names: string[],
	existsFn: ExistsFn = realExists,
): Promise<string | null> {
	for (const dir of dirs) {
		for (const name of names) {
			const full = path.join(dir, name);
			if (await existsFn(full)) return full;
		}
	}
	return null;
}

export async function findModel(
	dirs: string[],
	fileName: string,
	existsFn: ExistsFn = realExists,
): Promise<string | null> {
	for (const dir of dirs) {
		const full = path.join(dir, fileName);
		if (await existsFn(full)) return full;
	}
	return null;
}
