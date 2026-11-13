export const DEFAULT_CONVERSION_PROMPT_ES = `Convierte un dictado matemático en español en notas de Obsidian con Markdown y LaTeX.

Reglas:
- Escribe cada expresión matemática en LaTeX entre $...$ o $$...$$. Conserva el texto explicativo en español.
- Mantén el orden y todos los pasos dictados: igualdades sucesivas, sustituciones, descomposiciones, transformadas, límites y conclusiones. No resumas ni saltes pasos.
- Separa en líneas distintas las transformaciones matemáticas consecutivas. Conserva conectores como "reemplazando", "aplicando la inversa" y "cuando t tiende a infinito" como texto alrededor de las fórmulas.
- No resuelvas, completes ni corrijas operaciones que no se hayan dictado. Si un símbolo es ambiguo en la transcripción, conserva la formulación en español en vez de adivinarlo.
- Interpreta homófonos matemáticos: "equis" como x, "de equis" como dx, "i griega" como y, "hache" como h, "eme" como m, "ene" como n, "te" como t y "efe" como f o F según el contexto.
- En contexto matemático, distingue "e" constante, "igual" de la letra i y "por" de la letra x.
- "Barra barra" significa un salto de párrafo. Usa \\text{...} para palabras dentro de una fórmula.
- Si se dicta un gráfico, conserva su descripción como anotación en español; no inventes ni dibujes un gráfico.
- Devuelve únicamente el texto convertido, sin explicaciones adicionales.`;

export const DEFAULT_TRANSCRIPTION_CONTEXT_ES =
	"Dictado matemático en español: integral, derivada, sumatoria, raíz, fracción, límite, transformada de Laplace, fracciones parciales, alfa, beta, pi, infinito, subíndice, exponente, al cuadrado, tiende a, inversa, numerador, denominador.";

export interface LastDictation {
	filePath: string;
	from: number;
	to: number;
	text: string;
}

export interface LatexVoiceSettings {
	providerId: string;
	openaiApiKey: string;
	transcriptionBaseUrl: string;
	conversionBaseUrl: string;
	transcriptionModel: string;
	conversionModel: string;
	transcriptionContext: string;
	conversionPrompt: string;
	saveAudio: boolean;
	audioFolder: string;
	/** Silence after speech that ends a phrase, in milliseconds. */
	silenceMs: number;
	/** Hard cap for a single phrase, in milliseconds. */
	maxPhraseMs: number;
	/** Give up when no speech was heard for this long, in milliseconds. */
	graceMs: number;
	usage: {
		audioSeconds: number;
		inputTokens: number;
		outputTokens: number;
		requests: number;
	};
	/** Last inserted phrase, so "Corregir la última frase" survives a reload. */
	lastDictation?: LastDictation | null;
	/** E2E only. Requires devMode=true AND testAudioPath set — otherwise ignored. */
	devMode?: boolean;
	testAudioPath?: string;
}

export const DEFAULT_SETTINGS: LatexVoiceSettings = {
	providerId: "openai",
	openaiApiKey: "",
	transcriptionBaseUrl: "https://api.openai.com/v1",
	conversionBaseUrl: "https://api.openai.com/v1",
	transcriptionModel: "gpt-transcribe",
	conversionModel: "gpt-6-luna",
	transcriptionContext: DEFAULT_TRANSCRIPTION_CONTEXT_ES,
	conversionPrompt: DEFAULT_CONVERSION_PROMPT_ES,
	saveAudio: false,
	audioFolder: "recordings",
	silenceMs: 2800,
	maxPhraseMs: 60_000,
	graceMs: 10_000,
	usage: { audioSeconds: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
	lastDictation: null,
};

/**
 * The pre-0.2.0 defaults (per-language prompts) that an untouched user
 * may still have stored. Anything matching is upgraded to the Spanish
 * default; custom prompts are left alone.
 */
function isLegacyPrompt(value: unknown): boolean {
	return typeof value === "string" &&
		(value.startsWith("You convert Spanish dictated text") ||
			value.startsWith("You convert English dictated text"));
}

function isLegacyContext(value: unknown): boolean {
	return typeof value === "string" &&
		(value.startsWith("Spanish math dictation") ||
			value.startsWith("English math dictation"));
}

function isLastDictation(value: unknown): value is LastDictation {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return typeof v.filePath === "string" &&
		typeof v.from === "number" &&
		typeof v.to === "number" &&
		typeof v.text === "string";
}

/** Keeps a stored duration within safe bounds, falling back to the default. */
export function clampDuration(value: unknown, fallback: number, min: number, max: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Merges persisted data with defaults, dropping the removed `language`
 * setting, upgrading legacy default prompts and discarding a malformed
 * correction target.
 */
export function migrateSettings(
	raw: Record<string, unknown> | null | undefined,
): LatexVoiceSettings {
	const data = { ...(raw ?? {}) };
	delete data.language;

	if (typeof data.openaiBaseUrl === "string" && data.openaiBaseUrl !== "") {
		if (typeof data.transcriptionBaseUrl !== "string" || data.transcriptionBaseUrl === "")
			data.transcriptionBaseUrl = data.openaiBaseUrl;
		if (typeof data.conversionBaseUrl !== "string" || data.conversionBaseUrl === "")
			data.conversionBaseUrl = data.openaiBaseUrl;
	}
	delete data.openaiBaseUrl;

	const settings: LatexVoiceSettings = {
		...DEFAULT_SETTINGS,
		...data,
		usage: {
			...DEFAULT_SETTINGS.usage,
			...(typeof data.usage === "object" && data.usage !== null ? data.usage : {}),
		},
	};

	if (isLegacyPrompt(settings.conversionPrompt))
		settings.conversionPrompt = DEFAULT_CONVERSION_PROMPT_ES;
	if (isLegacyContext(settings.transcriptionContext))
		settings.transcriptionContext = DEFAULT_TRANSCRIPTION_CONTEXT_ES;
	if (!isLastDictation(settings.lastDictation))
		settings.lastDictation = null;
	settings.silenceMs = clampDuration(settings.silenceMs, DEFAULT_SETTINGS.silenceMs, 500, 10_000);
	settings.maxPhraseMs = clampDuration(settings.maxPhraseMs, DEFAULT_SETTINGS.maxPhraseMs, 5_000, 300_000);
	settings.graceMs = clampDuration(settings.graceMs, DEFAULT_SETTINGS.graceMs, 1_000, 60_000);

	return settings;
}

export function needsApiKey(settings: LatexVoiceSettings): boolean {
	return settings.transcriptionBaseUrl.includes("api.openai.com") ||
		settings.conversionBaseUrl.includes("api.openai.com");
}
