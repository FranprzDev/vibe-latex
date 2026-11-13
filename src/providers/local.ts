import {
	ConvertOptions,
	ConvertResult,
	TranscribeOptions,
	TranscriptionResult,
	VoiceProvider,
} from "./provider";
import { anySignal } from "../abort";
import { blobToWav, isWav } from "../local/wav";

export interface LocalProviderConfig {
	transcriptionBaseUrl: string;
	conversionBaseUrl: string;
	transcriptionModel: string;
	conversionModel: string;
}

interface TranscriptionResponse {
	text?: string;
	error?: { message?: string };
}

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	error?: { message?: string };
}

export class LocalProvider implements VoiceProvider {
	readonly id = "local";
	readonly displayName = "Modo local (gratis)";

	constructor(private config: LocalProviderConfig) {}

	private get transcriptionUrl(): string {
		return this.config.transcriptionBaseUrl.replace(/\/+$/, "");
	}

	private get conversionUrl(): string {
		return this.config.conversionBaseUrl.replace(/\/+$/, "");
	}

	async transcribe(audio: Blob, filename: string, opts: TranscribeOptions): Promise<TranscriptionResult> {
		const wav = isWav(audio, filename) ? audio : await blobToWav(audio);
		const wavName = filename.replace(/\.[^.]+$/, "") + ".wav";
		const form = new FormData();
		form.append("file", wav, wavName);
		form.append("response_format", "json");
		if (opts.language) {
			form.append("language", opts.language);
		}
		if (opts.contextPrompt) {
			form.append("prompt", opts.contextPrompt);
		}

		const res = await fetch(`${this.transcriptionUrl}/inference`, {
			method: "POST",
			body: form,
			signal: anySignal([AbortSignal.timeout(60_000), opts.signal]),
		});

		const data = (await res.json()) as TranscriptionResponse;
		if (!res.ok || !data.text) {
			throw new Error(`${data.error?.message ?? "Transcription failed"} (HTTP ${res.status})`);
		}
		return { text: data.text.trim() };
	}

	async convertToLatex(transcript: string, opts: ConvertOptions): Promise<ConvertResult> {
		const res = await fetch(`${this.conversionUrl}/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.config.conversionModel,
				messages: [
					{ role: "system", content: opts.systemPrompt },
					{ role: "user", content: transcript },
				],
			}),
			signal: anySignal([AbortSignal.timeout(60_000), opts.signal]),
		});

		const data = (await res.json()) as ChatResponse;
		const content = data.choices?.[0]?.message?.content;
		if (!res.ok || !content) {
			throw new Error(`${data.error?.message ?? "Conversion failed"} (HTTP ${res.status})`);
		}
		return {
			text: content.trim(),
			inputTokens: data.usage?.prompt_tokens,
			outputTokens: data.usage?.completion_tokens,
		};
	}
}
