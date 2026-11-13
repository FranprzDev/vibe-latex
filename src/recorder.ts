export interface CaptureOptions {
	signal?: AbortSignal;
	/** End the phrase after this much silence once speech was heard. */
	silenceMs?: number;
	/** Max phrase length. */
	/** Give up if no speech at all for this long. */
	graceMs?: number;
}

/** Maps a recording's mime type to a sane file extension. */
export function audioExtension(mimeType: string): string {
	const type = (mimeType || "").toLowerCase();
	if (type.includes("webm")) return "webm";
	if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
	if (type.includes("ogg") || type.includes("opus")) return "ogg";
	if (type.includes("wav")) return "wav";
	if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
	return "webm";
}

export class AudioRecorder {
	private recorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private startedAt = 0;

	/** Seconds recorded in the last session. */
	lastDurationSeconds = 0;

	get isRecording(): boolean {
		return this.recorder?.state === "recording";
	}

	get mimeType(): string {
		return this.recorder?.mimeType ?? "audio/webm";
	}

	async start(): Promise<void> {
		if (this.isRecording) return;
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mimeType = MediaRecorder.isTypeSupported("audio/webm")
				? "audio/webm"
				: undefined;
			this.recorder = new MediaRecorder(this.stream, { mimeType });
			this.chunks = [];
			this.recorder.ondataavailable = (e) => {
				if (e.data.size > 0) this.chunks.push(e.data);
			};
			this.startedAt = Date.now();
			this.recorder.start();
		} catch (e) {
			this.release();
			throw e;
		}
	}

	stop(): Promise<Blob> {
		return new Promise((resolve, reject) => {
			const recorder = this.recorder;
			if (!recorder || recorder.state !== "recording") {
				this.release();
				return reject(new Error("Not recording"));
			}
			recorder.onstop = () => {
				const blob = new Blob(this.chunks, { type: this.mimeType });
				this.lastDurationSeconds = (Date.now() - this.startedAt) / 1000;
				this.release();
				resolve(blob);
			};
			recorder.onerror = (e) => {
				this.release();
				reject(e);
			};
			recorder.stop();
		});
	}

	/**
	 * Record one phrase: starts the mic, ends when the speaker pauses
	 * (~silenceMs of low volume after speech) or opts.signal
	 * aborts. Returns null if nothing was heard before graceMs.
	 */
	async capturePhrase(opts: CaptureOptions = {}): Promise<Blob | null> {
		const silenceMs = opts.silenceMs ?? 2800;
		const graceMs = opts.graceMs ?? 10_000;

		await this.start();
		const stream = this.stream;
		if (!stream) throw new Error("No stream after start");

		const audioCtx = new AudioContext();
		const analyser = audioCtx.createAnalyser();
		analyser.fftSize = 512;
		audioCtx.createMediaStreamSource(stream).connect(analyser);
		const buf = new Uint8Array(analyser.frequencyBinCount);

		return new Promise<Blob | null>((resolve) => {
			let heardSpeech = false;
			let silenceStart: number | null = null;
			let finished = false;
			const start = Date.now();

			const finish = (keep: boolean) => {
				if (finished) return;
				finished = true;
				clearInterval(iv);
				void audioCtx.close().catch(() => undefined);
				this.stop()
					.then((b) => resolve(keep ? b : null))
					.catch(() => resolve(null));
			};

			const onAbort = () => finish(true);
			opts.signal?.addEventListener("abort", onAbort, { once: true });

			const iv = window.setInterval(() => {
				analyser.getByteTimeDomainData(buf);
				let sum = 0;
				for (const v of buf) {
					const d = v - 128;
					sum += d * d;
				}
				const rms = Math.sqrt(sum / buf.length);
				const now = Date.now();

				if (rms > 8) {
					heardSpeech = true;
					silenceStart = null;
				} else if (heardSpeech && silenceStart === null) {
					silenceStart = now;
				}

				if (opts.signal?.aborted) return finish(true);
				if (heardSpeech && silenceStart && now - silenceStart > silenceMs)
					return finish(true);
				if (!heardSpeech && now - start > graceMs) return finish(false);
			}, 100);
		});
	}

	/** Synchronous cleanup for plugin unload — never throws. */
	dispose(): void {
		try {
			if (this.recorder && this.recorder.state !== "inactive") {
				this.recorder.onstop = null;
				this.recorder.onerror = null;
				this.recorder.ondataavailable = null;
				this.recorder.stop();
			}
		} catch { /* ignore */ }
		this.release();
	}

	private release(): void {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.recorder = null;
		this.chunks = [];
	}
}
