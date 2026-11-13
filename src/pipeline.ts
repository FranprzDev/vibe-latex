import { VoiceProvider } from "./providers";
import { LatexVoiceSettings } from "./settings";
import { formatCommandOnly, stripLeadingEllipsis } from "./text-clean";

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

const MATH_OR_FORMAT =
	/\b(\d|integral|derivada|límite|limite|sumatoria|productoria|raíz|raiz|fracción|fraccion|exponente|logaritmo|seno|coseno|tangente|matriz|matrices|determinante|ecuación|ecuacion|polinomio|transformada|laplace|fourier|nyquist|bode|routh|hurwitz|transferencia|polo|polos|ceros?|sigma|delta|theta|omega|lambda|infinito|tiende a|subíndice|subindice|al cuadrado|al cubo|elevado|inversa|numerador|denominador|título|titulo|subtítulo|subtitulo|lista|negrita|cursiva|código|codigo|cita|gráfico|grafico)\b|\/\//i;

export function needsConversion(text: string): boolean {
	return MATH_OR_FORMAT.test(text);
}

export function conversionMaxTokens(text: string): number {
	return Math.min(1024, Math.max(128, text.length * 2));
}

export interface PipelineOptions {
	audioSeconds?: number;
	signal?: AbortSignal;
	onStep?: (step: "transcribing" | "converting") => void;
	onTranscript?: (transcript: string) => void;
	onToken?: (accumulated: string) => void;
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
	const transcript = stripLeadingEllipsis(t.text.trim());
	const marker = formatCommandOnly(transcript);
	if (marker !== null) {
		opts.onTranscript?.(transcript);
		return {
			transcript,
			output: marker,
			usage: { audioSeconds: t.durationSeconds ?? opts.audioSeconds },
		};
	}
	opts.onTranscript?.(transcript);
	if (!settings.alwaysConvert && !needsConversion(transcript)) {
		return {
			transcript,
			output: transcript,
			usage: { audioSeconds: t.durationSeconds ?? opts.audioSeconds },
		};
	}
	opts.onStep?.("converting");
	const c = await provider.convertToLatex(transcript, {
		systemPrompt: settings.conversionPrompt,
		signal: opts.signal,
		maxTokens: conversionMaxTokens(transcript),
		onToken: opts.onToken,
	});
	// "//" is the spoken paragraph-break marker.
	const converted = c.text.replace(/\s*\/\/\s*/g, "\n\n").trim();
	const output = applyOrderedListStyle(
		!converted || looksLikeMetaResponse(converted) ? transcript : converted,
	);
	return {
		transcript,
		output: await maybeImprove(output, settings),
		usage: {
			audioSeconds: t.durationSeconds ?? opts.audioSeconds,
			inputTokens: c.inputTokens,
			outputTokens: c.outputTokens,
		},
	};
}

export async function convertPlainText(
	provider: VoiceProvider,
	text: string,
	settings: LatexVoiceSettings,
): Promise<string> {
	const c = await provider.convertToLatex(text.trim(), {
		systemPrompt: settings.conversionPrompt,
	});
	const converted = c.text.replace(/\s*\/\/\s*/g, "\n\n").trim();
	const output = applyOrderedListStyle(
		!converted || looksLikeMetaResponse(converted) ? text.trim() : converted,
	);
	return maybeImprove(output, settings);
}

export async function convertImageToLatex(
	imageBase64: string,
	settings: LatexVoiceSettings,
): Promise<string | null> {
	if (!settings.improveEnabled || !settings.improveUrl?.trim()) return null;
	try {
		const res = await fetch(`${settings.improveUrl.trim()}/vision`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ image: imageBase64 }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { text?: string };
		return data.text?.trim() || null;
	} catch {
		return null;
	}
}

async function maybeImprove(text: string, settings: LatexVoiceSettings): Promise<string> {
	if (!settings.improveEnabled || !settings.improveUrl?.trim()) return text;
	try {
		const res = await fetch(settings.improveUrl.trim(), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
			signal: AbortSignal.timeout(8_000),
		});
		if (!res.ok) return text;
		const data = (await res.json()) as { text?: string };
		return data.text?.trim() || text;
	} catch {
		return text;
	}
}
