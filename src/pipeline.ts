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

export const EDIT_SYSTEM_PROMPT = `Recibís un pasaje de notas de estudio en Markdown con LaTeX y una instrucción de corrección dictada por voz, en español.
Reglas estrictas:
- Aplicá ÚNICAMENTE lo que pide la instrucción sobre el pasaje: correcciones de valores, signos, términos, orden o formato pedidos explícitamente.
- NUNCA agregues contenido nuevo: ni definiciones, ejemplos, pasos ni fórmulas que la instrucción no pida.
- Conservá el formato Markdown y las fórmulas LaTeX ($...$, $$...$$) salvo que la instrucción pida cambiarlos.
- Si la instrucción es ambigua, aplicá la interpretación más literal.
- Devolvé ÚNICAMENTE el pasaje reescrito, sin explicaciones, comentarios ni texto adicional.`;

export function buildEditUserText(passage: string, instruction: string): string {
	return `PASAJE:\n${passage}\n\nINSTRUCCIÓN:\n${instruction}`;
}

export async function applyVoiceEdit(
	provider: VoiceProvider,
	passage: string,
	instruction: string,
): Promise<string | null> {
	const c = await provider.convertToLatex(buildEditUserText(passage, instruction), {
		systemPrompt: EDIT_SYSTEM_PROMPT,
		maxTokens: Math.min(4096, Math.max(1024, Math.ceil(passage.length / 2) + 256)),
	});
	const out = c.text.trim();
	if (!out || looksLikeMetaResponse(out)) return null;
	return out;
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

const VISION_PREFIXES = [
	/^the (equation|formula|table|image|latex)( is)?[::]?\s*/i,
	/^here is the (equation|formula|table|latex)[::]?\s*/i,
];

export function cleanVisionLatex(raw: string): string | null {
	let text = raw.trim();
	const fence = text.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
	if (fence) text = fence[1].trim();
	const doc = text.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/i);
	if (doc) text = doc[1].trim();
	for (const prefix of VISION_PREFIXES) text = text.replace(prefix, "");
	text = text.trim();
	if (!text) return null;
	if (looksLikeMetaResponse(text)) return null;
	return text;
}

export async function convertImageLocal(
	imageBase64: string,
	endpoint: string,
	apiKey: string,
): Promise<string | null> {
	const body = JSON.stringify({
		model: "lfm-vl",
		messages: [
			{
				role: "user",
				content: [
					{ type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
					{
						type: "text",
						text: "Extract the math from the image and output it as LaTeX. If it is a table, use a tabular environment. Output ONLY the LaTeX code, no explanation.",
					},
				],
			},
		],
		temperature: 0.1,
		max_tokens: 512,
		min_p: 0.15,
		repeat_penalty: 1.05,
	});
	for (let attempt = 0; attempt < 30; attempt++) {
		try {
			const res = await fetch(`${endpoint}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body,
				signal: AbortSignal.timeout(120_000),
			});
			if (res.status === 503) {
				await new Promise((r) => setTimeout(r, 2_000));
				continue;
			}
			if (!res.ok) return null;
			const data = (await res.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			return cleanVisionLatex(data.choices?.[0]?.message?.content ?? "");
		} catch {
			return null;
		}
	}
	return null;
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
