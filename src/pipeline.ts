import { VoiceProvider } from "./providers";
import { LatexVoiceSettings } from "./settings";

/**
 * Core dictation pipeline, decoupled from Obsidian so it can be tested
 * directly: audio in, Markdown+LaTeX out.
 */
export interface PipelineResult {
	transcript: string;
	output: string;
	usage: {
		audioSeconds?: number;
		inputTokens?: number;
		outputTokens?: number;
	};
}

export interface PipelineOptions {
	audioSeconds?: number;
	signal?: AbortSignal;
	onStep?: (step: "transcribing" | "converting") => void;
	onTranscript?: (transcript: string) => void;
}

export async function dictatePipeline(
	provider: VoiceProvider,
	audio: Blob,
	filename: string,
	settings: LatexVoiceSettings,
	opts: PipelineOptions = {},
): Promise<PipelineResult> {
	opts.onStep?.("transcribing");
	const t = await provider.transcribe(audio, filename, {
		language: "es",
		contextPrompt: settings.transcriptionContext,
		signal: opts.signal,
	});
	if (!t.text.trim()) {
		throw new Error("empty transcript");
	}
	opts.onTranscript?.(t.text);
	opts.onStep?.("converting");
	const c = await provider.convertToLatex(t.text, {
		systemPrompt: settings.conversionPrompt,
		signal: opts.signal,
	});
	// "//" is the spoken paragraph-break marker.
	const output = c.text.replace(/\s*\/\/\s*/g, "\n\n").trim();
	if (!output) throw new Error("empty conversion");
	return {
		transcript: t.text,
		output,
		usage: {
			audioSeconds: t.durationSeconds ?? opts.audioSeconds,
			inputTokens: c.inputTokens,
			outputTokens: c.outputTokens,
		},
	};
}
