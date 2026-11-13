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


const SILENCE_HALLUCINATIONS = new Set([
	"gracias",
	"thank you",
	"thanks for watching",
	"suscribete",
	"subscribete",
	"subtitulos",
	"subtitulos por",
	"amara.org",
]);

const META_MARKERS = [
	"no se ha dictado",
	"no se dicto",
	"proporcione el dictado",
	"proporciona el dictado",
	"no se proporciono",
	"no se ha proporcionado",
	"no hay contenido para convertir",
	"no se recibio",
];

function normalizeText(s: string): string {
	return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function isBlankTranscript(text: string): boolean {
	const cleaned = normalizeText(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
	if (cleaned.length === 0) return true;
	if (cleaned.includes("amara") || cleaned.includes("subtitulos")) return true;
	return SILENCE_HALLUCINATIONS.has(cleaned);
}

export function looksLikeMetaResponse(text: string): boolean {
	const normalized = normalizeText(text);
	return META_MARKERS.some((m) => normalized.includes(m));
}

export function applyOrderedListStyle(text: string): string {
	const markers = text.split("\n").filter((l) => /^\s*\d+\.\s/.test(l));
	if (markers.length < 2) return text;
	return text.replace(/^(\s*)(\d+)\.\s+/gm, "$1$2) ");
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
	if (isBlankTranscript(t.text)) {
		throw new Error("empty transcript");
	}
	opts.onTranscript?.(t.text);
	opts.onStep?.("converting");
	const c = await provider.convertToLatex(t.text, {
		systemPrompt: settings.conversionPrompt,
		signal: opts.signal,
	});
	// "//" is the spoken paragraph-break marker.
	const converted = c.text.replace(/\s*\/\/\s*/g, "\n\n").trim();
	const output = applyOrderedListStyle(
		!converted || looksLikeMetaResponse(converted) ? t.text.trim() : converted,
	);
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
