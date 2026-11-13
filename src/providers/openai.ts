import {
	ConvertOptions,
	ConvertResult,
	TranscribeOptions,
	TranscriptionResult,
	VoiceProvider,
} from "./provider";
import { anySignal } from "../abort";

export interface OpenAIProviderConfig {
	apiKey: string;
	transcriptionBaseUrl: string;
	conversionBaseUrl: string;
	transcriptionModel: string;
	conversionModel: string;
}

interface TranscriptionResponse {
	text?: string;
	duration?: number;
	error?: { message?: string };
}

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	error?: { message?: string };
}

export class OpenAIProvider implements VoiceProvider {
	readonly id = "openai";
	readonly displayName = "OpenAI";

	constructor(private config: OpenAIProviderConfig) {}

	private get transcriptionUrl(): string {
		return this.config.transcriptionBaseUrl.replace(/\/+$/, "");
	}

	private get conversionUrl(): string {
		return this.config.conversionBaseUrl.replace(/\/+$/, "");
	}

	private headers(extra?: Record<string, string>): Record<string, string> {
		if (this.config.apiKey) {
			return {
				Authorization: `Bearer ${this.config.apiKey}`,
				...extra,
			};
		}
		return { ...extra };
	}

	async transcribe(audio: Blob, filename: string, opts: TranscribeOptions): Promise<TranscriptionResult> {
		const form = new FormData();
		form.append("file", audio, filename);
		form.append("model", this.config.transcriptionModel);
		if (opts.language) {
			form.append("language", opts.language);
		}
		if (opts.contextPrompt) {
			form.append("prompt", opts.contextPrompt);
		}

		const res = await fetch(`${this.transcriptionUrl}/audio/transcriptions`, {
			method: "POST",
			headers: this.headers(),
			body: form,
			signal: anySignal([AbortSignal.timeout(60_000), opts.signal]),
		});

		const data = (await res.json()) as TranscriptionResponse;
		if (!res.ok || !data.text) {
			throw new Error(`${data.error?.message ?? "Transcription failed"} (HTTP ${res.status})`);
		}
		return { text: data.text, durationSeconds: data.duration };
	}

	async convertToLatex(transcript: string, opts: ConvertOptions): Promise<ConvertResult> {
		const res = await fetch(`${this.conversionUrl}/chat/completions`, {
			method: "POST",
			headers: this.headers({ "Content-Type": "application/json" }),
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
