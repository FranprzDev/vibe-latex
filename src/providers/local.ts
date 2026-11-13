import {
	ConvertOptions,
	ConvertResult,
	TranscribeOptions,
	TranscriptionResult,
	VoiceProvider,
} from "./provider";
import { anySignal } from "../abort";
import { blobToWav, isWav } from "../local/wav";
import { CONVERT_TIMEOUT_MS, TRANSCRIBE_TIMEOUT_MS } from "./timeouts";

export interface LocalProviderConfig {
	transcriptionBaseUrl: string;
	conversionBaseUrl: string;
	transcriptionModel: string;
	conversionModel: string;
	apiKey?: string;
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

	private authHeaders(): Record<string, string> {
		return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
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
			headers: this.authHeaders(),
			body: form,
			signal: anySignal([AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS), opts.signal]),
		});

		const data = (await res.json()) as TranscriptionResponse;
		if (!res.ok || !data.text) {
			throw new Error(`${data.error?.message ?? "Transcription failed"} (HTTP ${res.status})`);
		}
		return { text: data.text.trim() };
	}

	async convertToLatex(transcript: string, opts: ConvertOptions): Promise<ConvertResult> {
		const stream = !!opts.onToken;
		const res = await fetch(`${this.conversionUrl}/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...this.authHeaders() },
			body: JSON.stringify({
				model: this.config.conversionModel,
				messages: [
					{ role: "system", content: opts.systemPrompt },
					{ role: "user", content: transcript },
				],
				max_tokens: opts.maxTokens ?? 1024,
				stream,
				chat_template_kwargs: { enable_thinking: false },
			}),
			signal: anySignal([AbortSignal.timeout(CONVERT_TIMEOUT_MS), opts.signal]),
		});

		if (stream) return this.readStream(res, opts.onToken!);

		const data = (await res.json()) as ChatResponse;
		const raw = data.choices?.[0]?.message?.content;
		const content = raw?.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
		if (!res.ok || !content) {
			throw new Error(`${data.error?.message ?? "Conversion failed"} (HTTP ${res.status})`);
		}
		return {
			text: content,
			inputTokens: data.usage?.prompt_tokens,
			outputTokens: data.usage?.completion_tokens,
		};
	}

	private async readStream(res: Response, onToken: (accumulated: string) => void): Promise<ConvertResult> {
		if (!res.ok || !res.body) {
			const data = (await res.json().catch(() => ({}))) as ChatResponse;
			throw new Error(`${data.error?.message ?? "Conversion failed"} (HTTP ${res.status})`);
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		let content = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			let idx: number;
			while ((idx = buf.indexOf("\n\n")) >= 0) {
				const event = buf.slice(0, idx);
				buf = buf.slice(idx + 2);
				for (const line of event.split("\n")) {
					if (!line.startsWith("data:")) continue;
					const payload = line.slice(5).trim();
					if (payload === "[DONE]") continue;
					try {
						const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
						const delta = j.choices?.[0]?.delta?.content;
						if (delta) {
							content += delta;
							onToken(content.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim());
						}
					} catch {
						// ignore malformed SSE events
					}
				}
			}
		}
		const cleaned = content.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
		if (!cleaned) throw new Error("Conversion failed (empty stream)");
		return { text: cleaned };
	}
}
