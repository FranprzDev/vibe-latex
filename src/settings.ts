export const DEFAULT_CONVERSION_PROMPT_ES = `Convierte un dictado matemático en español en notas de Obsidian con Markdown y LaTeX.

Reglas:
- Escribe cada expresión matemática en LaTeX entre $...$ o $$...$$. Conserva el texto explicativo en español.
- Mantén el orden y todos los pasos dictados: igualdades sucesivas, sustituciones, descomposiciones, transformadas, límites y conclusiones. No resumas ni saltes pasos.
- Separa en líneas distintas las transformaciones matemáticas consecutivas. Conserva conectores como "reemplazando", "aplicando la inversa" y "cuando t tiende a infinito" como texto alrededor de las fórmulas.
- No resuelvas, completes ni corrijas operaciones que no se hayan dictado. Si un símbolo es ambiguo en la transcripción, conserva la formulación en español en vez de adivinarlo.
- Interpreta homófonos matemáticos: "equis" como x, "de equis" como dx, "i griega" como y, "hache" como h, "eme" como m, "ene" como n, "te" como t y "efe" como f o F según el contexto.
- En contexto matemático, distingue "e" constante, "igual" de la letra i y "por" de la letra x.
- Convierte siempre los conceptos matemáticos dictados a su símbolo LaTeX, nunca los dejes como texto: "infinito" → $\\infty$ ("más infinito" → $+\\infty$, "menos infinito" → $-\\infty$), "sumatoria" → $\\sum$, "productoria" → $\\prod$, "límite cuando equis tiende a a" → $\\lim_{x \\to a}$, "raíz cuadrada de" → $\\sqrt{...}$, "raíz enésima" → $\\sqrt[n]{...}$, "pi" → $\\pi$, "valor absoluto" → $|...|$, "mayor o igual" → $\\geq$, "menor o igual" → $\\leq$, "distinto de" → $\\neq$, "aproximadamente igual" → $\\approx$, "más menos" → $\\pm$, "pertenece a" → $\\in$, "para todo" → $\\forall$, "existe" → $\\exists$, "unión" → $\\cup$, "intersección" → $\\cap$, letras griegas dictadas ("alfa", "beta", "gamma", "delta", "épsilon", "theta", "lambda", "mu", "sigma", "tau", "fi", "omega") → $\\alpha$, $\\beta$, $\\gamma$, $\\delta$, $\\epsilon$, $\\theta$, $\\lambda$, $\\mu$, $\\sigma$, $\\tau$, $\\phi$, $\\omega$.
- "Barra barra" significa un salto de párrafo. Usa \\text{...} para palabras dentro de una fórmula.
- Reconoce comandos de formato dictados y no conserves la palabra del comando en el texto: "título X" o "esto es un título: X" → una línea de encabezado Markdown \`# X\`; "subtítulo X" → \`## X\`; "lista" seguida de ítems → líneas \`- ítem\`; "negrita X" → \`**X**\`; "cursiva X" → \`*X*\`; "código X" → \`X\` entre comillas invertidas; "cita X" → \`> X\`. Dentro del argumento se siguen aplicando las reglas matemáticas.
- Si se dicta un gráfico, conserva su descripción como anotación en español; no inventes ni dibujes un gráfico.
- Las enumeraciones dictadas ("el primero...", "el segundo...", "uno...", "dos...") se escriben como lista numerada con paréntesis: "1) ...", "2) ...", "3) ..." (nunca "1.").
- Nunca respondas con comentarios, aclaraciones, preguntas ni mensajes sobre el dictado (por ejemplo "no se ha dictado ninguna expresión"). Si no hay contenido para convertir, devuelve la entrada sin cambios. Devuelve únicamente el texto convertido, sin explicaciones adicionales.
- No agregues NADA que no esté dictado: ni definiciones, ejemplos, desarrollos, títulos ni fórmulas. Si el dictado es solo una instrucción de formato sin contenido, devuelve únicamente el marcador Markdown correspondiente. Si la entrada es un término, título o frase suelta, devuelve solo eso corregido.
- Los "..." al inicio o final de una frase son cortes del audio, no pausas retóricas: ignóralos y une la oración con lo que sigue.`;

const PREVIOUS_CONVERSION_PROMPTS: string[] = [
	`Convierte un dictado matemático en español en notas de Obsidian con Markdown y LaTeX.

Reglas:
- Escribe cada expresión matemática en LaTeX entre $...$ o $$...$$. Conserva el texto explicativo en español.
- Mantén el orden y todos los pasos dictados: igualdades sucesivas, sustituciones, descomposiciones, transformadas, límites y conclusiones. No resumas ni saltes pasos.
- Separa en líneas distintas las transformaciones matemáticas consecutivas. Conserva conectores como "reemplazando", "aplicando la inversa" y "cuando t tiende a infinito" como texto alrededor de las fórmulas.
- No resuelvas, completes ni corrijas operaciones que no se hayan dictado. Si un símbolo es ambiguo en la transcripción, conserva la formulación en español en vez de adivinarlo.
- Interpreta homófonos matemáticos: "equis" como x, "de equis" como dx, "i griega" como y, "hache" como h, "eme" como m, "ene" como n, "te" como t y "efe" como f o F según el contexto.
- En contexto matemático, distingue "e" constante, "igual" de la letra i y "por" de la letra x.
- Convierte siempre los conceptos matemáticos dictados a su símbolo LaTeX, nunca los dejes como texto: "infinito" → $\\infty$ ("más infinito" → $+\\infty$, "menos infinito" → $-\\infty$), "sumatoria" → $\\sum$, "productoria" → $\\prod$, "límite cuando equis tiende a a" → $\\lim_{x \\to a}$, "raíz cuadrada de" → $\\sqrt{...}$, "raíz enésima" → $\\sqrt[n]{...}$, "pi" → $\\pi$, "valor absoluto" → $|...|$, "mayor o igual" → $\\geq$, "menor o igual" → $\\leq$, "distinto de" → $\\neq$, "aproximadamente igual" → $\\approx$, "más menos" → $\\pm$, "pertenece a" → $\\in$, "para todo" → $\\forall$, "existe" → $\\exists$, "unión" → $\\cup$, "intersección" → $\\cap$, letras griegas dictadas ("alfa", "beta", "gamma", "delta", "épsilon", "theta", "lambda", "mu", "sigma", "tau", "fi", "omega") → $\\alpha$, $\\beta$, $\\gamma$, $\\delta$, $\\epsilon$, $\\theta$, $\\lambda$, $\\mu$, $\\sigma$, $\\tau$, $\\phi$, $\\omega$.
- "Barra barra" significa un salto de párrafo. Usa \\text{...} para palabras dentro de una fórmula.
- Reconoce comandos de formato dictados y no conserves la palabra del comando en el texto: "título X" o "esto es un título: X" → una línea de encabezado Markdown \`# X\`; "subtítulo X" → \`## X\`; "lista" seguida de ítems → líneas \`- ítem\`; "negrita X" → \`**X**\`; "cursiva X" → \`*X*\`; "código X" → \`X\` entre comillas invertidas; "cita X" → \`> X\`. Dentro del argumento se siguen aplicando las reglas matemáticas.
- Si se dicta un gráfico, conserva su descripción como anotación en español; no inventes ni dibujes un gráfico.
- Las enumeraciones dictadas ("el primero...", "el segundo...", "uno...", "dos...") se escriben como lista numerada con paréntesis: "1) ...", "2) ...", "3) ..." (nunca "1.").
- Nunca respondas con comentarios, aclaraciones, preguntas ni mensajes sobre el dictado (por ejemplo "no se ha dictado ninguna expresión"). Si no hay contenido para convertir, devuelve la entrada sin cambios. Devuelve únicamente el texto convertido, sin explicaciones adicionales.`,
];

const PREVIOUS_TRANSCRIPTION_CONTEXTS: string[] = [
	"Dictado matemático en español: integral, derivada, sumatoria, raíz, fracción, límite, transformada de Laplace, fracciones parciales, alfa, beta, pi, infinito, subíndice, exponente, al cuadrado, tiende a, inversa, numerador, denominador.",
];

export const DEFAULT_TRANSCRIPTION_CONTEXT_ES =
	"Dictado matemático en español: integral, derivada, sumatoria, raíz, fracción, límite, transformada de Laplace, fracciones parciales, alfa, beta, pi, infinito, subíndice, exponente, al cuadrado, tiende a, inversa, numerador, denominador, Routh-Hurwitz, Nyquist, Bode, lugar de las raíces, función de transferencia, polo, cero, PID, espacio de estados, estabilidad, transformada Z.";

export interface LastDictation {
	filePath: string;
	from: number;
	to: number;
	text: string;
}

export interface PreviousRemoteSettings {
	providerId: string;
	transcriptionBaseUrl: string;
	conversionBaseUrl: string;
	transcriptionModel: string;
	conversionModel: string;
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
	/** Inserts the transcript immediately, then swaps it for the converted LaTeX. */
	streamingInsert: boolean;
	improveEnabled: boolean;
	improveUrl: string;
	whisperServerPath: string;
	llamaServerPath: string;
	whisperModelPath: string;
	llmModelPath: string;
	saveAudio: boolean;
	audioFolder: string;
	/** Silence after speech that ends a phrase, in milliseconds. */
	silenceMs: number;
	/** Hard cap for a single phrase, in milliseconds. */
	/** Give up when no speech was heard for this long, in milliseconds. */
	graceMs: number;
	sttPort: number;
	llmPort: number;
	localLlmApiKey: string;
	autoStartLocal: boolean;
	usage: {
		audioSeconds: number;
		inputTokens: number;
		outputTokens: number;
		requests: number;
	};
	/** Last inserted phrase, so "Corregir la última frase" survives a reload. */
	lastDictation?: LastDictation | null;
	/** Remote provider config to restore when local mode is deactivated. */
	previousRemoteSettings?: PreviousRemoteSettings | null;
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
	streamingInsert: true,
	improveEnabled: false,
	improveUrl: "https://vibe-latex-improve.franprzdev.workers.dev",
	whisperServerPath: "",
	llamaServerPath: "",
	whisperModelPath: "",
	llmModelPath: "",
	saveAudio: false,
	audioFolder: "recordings",
	silenceMs: 2800,
	graceMs: 10_000,
	sttPort: 10000,
	llmPort: 8082,
	localLlmApiKey: "",
	autoStartLocal: true,
	usage: { audioSeconds: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
	lastDictation: null,
	previousRemoteSettings: null,
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

function isPreviousRemoteSettings(value: unknown): value is PreviousRemoteSettings {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return typeof v.providerId === "string" &&
		typeof v.transcriptionBaseUrl === "string" &&
		typeof v.conversionBaseUrl === "string" &&
		typeof v.transcriptionModel === "string" &&
		typeof v.conversionModel === "string";
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
	delete data.glossary;
	delete data.maxPhraseMs;

	if (data.sttPort === 8081) data.sttPort = DEFAULT_SETTINGS.sttPort;
	if (data.transcriptionBaseUrl === "http://127.0.0.1:8081")
		data.transcriptionBaseUrl = `http://127.0.0.1:${DEFAULT_SETTINGS.sttPort}`;

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

	if (isLegacyPrompt(settings.conversionPrompt) ||
		PREVIOUS_CONVERSION_PROMPTS.includes(settings.conversionPrompt) ||
		(settings.conversionPrompt.startsWith("Convierte un dictado matemático en español") &&
			!settings.conversionPrompt.includes("No agregues NADA")))
		settings.conversionPrompt = DEFAULT_CONVERSION_PROMPT_ES;
	if (isLegacyContext(settings.transcriptionContext) ||
		PREVIOUS_TRANSCRIPTION_CONTEXTS.includes(settings.transcriptionContext) ||
		(settings.transcriptionContext.startsWith("Dictado matemático en español:") &&
			!settings.transcriptionContext.includes("Routh-Hurwitz")))
		settings.transcriptionContext = DEFAULT_TRANSCRIPTION_CONTEXT_ES;
	if (typeof settings.improveEnabled !== "boolean")
		settings.improveEnabled = DEFAULT_SETTINGS.improveEnabled;
	if (typeof settings.improveUrl !== "string")
		settings.improveUrl = DEFAULT_SETTINGS.improveUrl;
	if (typeof settings.whisperServerPath !== "string") settings.whisperServerPath = "";
	if (typeof settings.llamaServerPath !== "string") settings.llamaServerPath = "";
	if (typeof settings.whisperModelPath !== "string") settings.whisperModelPath = "";
	if (typeof settings.llmModelPath !== "string") settings.llmModelPath = "";
	if (typeof settings.streamingInsert !== "boolean")
		settings.streamingInsert = DEFAULT_SETTINGS.streamingInsert;
	if (!isLastDictation(settings.lastDictation))
		settings.lastDictation = null;
	if (!isPreviousRemoteSettings(settings.previousRemoteSettings))
		settings.previousRemoteSettings = null;
	settings.silenceMs = clampDuration(settings.silenceMs, DEFAULT_SETTINGS.silenceMs, 500, 10_000);
	settings.graceMs = clampDuration(settings.graceMs, DEFAULT_SETTINGS.graceMs, 1_000, 60_000);
	settings.sttPort = clampDuration(settings.sttPort, DEFAULT_SETTINGS.sttPort, 1024, 65_535);
	settings.llmPort = clampDuration(settings.llmPort, DEFAULT_SETTINGS.llmPort, 1024, 65_535);

	return settings;
}

export function needsApiKey(settings: LatexVoiceSettings): boolean {
	if (settings.providerId === "local") return false;
	return settings.transcriptionBaseUrl.includes("api.openai.com") ||
		settings.conversionBaseUrl.includes("api.openai.com");
}
