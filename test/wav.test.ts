import { describe, it, expect, vi, afterEach } from "vitest";
import { blobToWav, isWav } from "../src/local/wav";

class FakeSource {
	buffer: unknown = null;
	connect() {}
	start() {}
}

class FakeOfflineAudioContext {
	static created: Array<{ channels: number; frames: number; sampleRate: number }> = [];
	destination = {};
	constructor(
		public channels: number,
		public frames: number,
		public sampleRate: number,
	) {
		FakeOfflineAudioContext.created.push({ channels, frames, sampleRate });
	}
	decodeAudioData(_data: ArrayBuffer): Promise<AudioBuffer> {
		return Promise.resolve({ duration: 1 } as AudioBuffer);
	}
	createBufferSource() {
		return new FakeSource();
	}
	startRendering(): Promise<AudioBuffer> {
		return Promise.resolve({
			getChannelData: () => new Float32Array(this.frames),
		} as unknown as AudioBuffer);
	}
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	FakeOfflineAudioContext.created = [];
});

describe("isWav", () => {
	it("detects wav by mime type or extension", () => {
		expect(isWav(new Blob([], { type: "audio/wav" }), "d")).toBe(true);
		expect(isWav(new Blob([], { type: "" }), "D.WAV")).toBe(true);
		expect(isWav(new Blob([], { type: "audio/webm" }), "d.webm")).toBe(false);
	});
});

describe("blobToWav", () => {
	it("decodes with a minimal offline context and resamples in a second one", async () => {
		vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
		const out = await blobToWav(new Blob(["x"]), 16_000);
		expect(out.type).toBe("audio/wav");
		expect(FakeOfflineAudioContext.created).toEqual([
			{ channels: 1, frames: 1, sampleRate: 44_100 },
			{ channels: 1, frames: 16_000, sampleRate: 16_000 },
		]);
		const bytes = new Uint8Array(await out.arrayBuffer());
		expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
		expect(String.fromCharCode(...bytes.slice(8, 12))).toBe("WAVE");
	});

	it("rejects with a decode timeout when decoding never settles", async () => {
		vi.useFakeTimers();
		class HangingOfflineAudioContext extends FakeOfflineAudioContext {
			decodeAudioData(): Promise<AudioBuffer> {
				return new Promise(() => {});
			}
		}
		vi.stubGlobal("OfflineAudioContext", HangingOfflineAudioContext);
		const pending = blobToWav(new Blob(["x"]));
		const rejection = expect(pending).rejects.toThrow("audio decode timeout");
		await vi.advanceTimersByTimeAsync(30_000);
		await rejection;
	});

	it("rejects with a decode timeout when rendering never settles", async () => {
		vi.useFakeTimers();
		class HangingOfflineAudioContext extends FakeOfflineAudioContext {
			startRendering(): Promise<AudioBuffer> {
				return new Promise(() => {});
			}
		}
		vi.stubGlobal("OfflineAudioContext", HangingOfflineAudioContext);
		const pending = blobToWav(new Blob(["x"]));
		const rejection = expect(pending).rejects.toThrow("audio decode timeout");
		await vi.advanceTimersByTimeAsync(30_000);
		await rejection;
	});

	it("throws when Web Audio is unavailable", async () => {
		vi.stubGlobal("OfflineAudioContext", undefined);
		vi.stubGlobal("webkitOfflineAudioContext", undefined);
		await expect(blobToWav(new Blob(["x"]))).rejects.toThrow("Web Audio");
	});
});
