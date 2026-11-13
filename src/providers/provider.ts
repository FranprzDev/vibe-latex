export interface TranscribeOptions {
	language?: string;
	contextPrompt?: string;
	signal?: AbortSignal;
}

export interface ConvertOptions {
	systemPrompt: string;
	signal?: AbortSignal;
	maxTokens?: number;
	onToken?: (accumulated: string) => void;
}

/**
 * A voice provider bundles the two AI capabilities this plugin needs:
 * speech-to-text and text-to-LaTeX conversion. Adding support for a new
 * backend (Groq, Ollama, Deepgram+LLM, ...) is a matter of implementing
 * this interface and registering it in providers/index.ts.
 */
export interface TranscriptionResult {
	text: string;
	/** Audio duration in seconds, when the API reports it. */
	durationSeconds?: number;
}

export interface ConvertResult {
	text: string;
	inputTokens?: number;
	outputTokens?: number;
}

export interface VoiceProvider {
	readonly id: string;
	readonly displayName: string;

	transcribe(audio: Blob, filename: string, opts: TranscribeOptions): Promise<TranscriptionResult>;
	convertToLatex(transcript: string, opts: ConvertOptions): Promise<ConvertResult>;
}
