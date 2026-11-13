interface AudioContextLike {
	decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
	close(): Promise<void>;
}

interface OfflineAudioContextLike {
	createBufferSource(): AudioBufferSourceNode;
	startRendering(): Promise<AudioBuffer>;
	destination: AudioDestinationNode;
}

function audioContextCtor(): (new () => AudioContextLike) | null {
	const g = globalThis as Record<string, unknown>;
	return (g.AudioContext ?? g.webkitAudioContext) as (new () => AudioContextLike) | null ?? null;
}

function offlineAudioContextCtor():
	| (new (channels: number, frames: number, sampleRate: number) => OfflineAudioContextLike)
	| null {
	const g = globalThis as Record<string, unknown>;
	return (g.OfflineAudioContext ?? g.webkitOfflineAudioContext) as
		| (new (channels: number, frames: number, sampleRate: number) => OfflineAudioContextLike)
		| null
		?? null;
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const bytesPerSample = 2;
	const dataSize = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);
	const writeString = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};
	writeString(0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(8, "WAVE");
	writeString(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * bytesPerSample, true);
	view.setUint16(32, bytesPerSample, true);
	view.setUint16(34, 8 * bytesPerSample, true);
	writeString(36, "data");
	view.setUint32(40, dataSize, true);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(44 + i * bytesPerSample, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return buffer;
}

export function isWav(blob: Blob, filename: string): boolean {
	return blob.type.includes("wav") || filename.toLowerCase().endsWith(".wav");
}

export async function blobToWav(blob: Blob, targetSampleRate = 16_000): Promise<Blob> {
	const AC = audioContextCtor();
	const OfflineAC = offlineAudioContextCtor();
	if (!AC || !OfflineAC) {
		throw new Error("Web Audio no está disponible para convertir el audio a WAV.");
	}
	const arrayBuffer = await blob.arrayBuffer();
	const ctx = new AC();
	let decoded: AudioBuffer;
	try {
		decoded = await ctx.decodeAudioData(arrayBuffer);
	} finally {
		void ctx.close();
	}
	const frames = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
	const offline = new OfflineAC(1, frames, targetSampleRate);
	const source = offline.createBufferSource();
	source.buffer = decoded;
	source.connect(offline.destination);
	source.start();
	const rendered = await offline.startRendering();
	const pcm = rendered.getChannelData(0);
	return new Blob([encodeWavPcm16(pcm, targetSampleRate)], { type: "audio/wav" });
}
