import { describe, it, expect, vi } from "vitest";
import { cleanVisionLatex, dictatePipeline } from "../src/pipeline";
import { VoiceProvider } from "../src/providers";
import { DEFAULT_SETTINGS } from "../src/settings";

const CONVERT_SETTINGS = { ...DEFAULT_SETTINGS, alwaysConvert: true };

const fakeProvider: VoiceProvider = {
	id: "fake",
	displayName: "Fake",
	async transcribe(_audio, filename, opts) {
		expect(opts.language).toBe("es");
		expect(opts.contextPrompt).toContain("integral");
		return { text: `transcribed ${filename}`, durationSeconds: 2.5 };
	},
	async convertToLatex(transcript, opts) {
		expect(opts.systemPrompt).toBe(DEFAULT_SETTINGS.conversionPrompt);
		return { text: `converted: ${transcript}`, inputTokens: 10, outputTokens: 5 };
	},
};

describe("dictatePipeline", () => {
	it("chains transcribe → convertToLatex and returns both", async () => {
		const { transcript, output, usage } = await dictatePipeline(
			fakeProvider,
			new Blob(["a"]),
			"d.m4a",
			CONVERT_SETTINGS,
		);
		expect(transcript).toBe("transcribed d.m4a");
		expect(output).toBe("converted: transcribed d.m4a");
		expect(usage).toEqual({ audioSeconds: 2.5, inputTokens: 10, outputTokens: 5 });
	});

	it("propagates transcription errors", async () => {
		const failing: VoiceProvider = {
			...fakeProvider,
			transcribe: async () => {
				throw new Error("mic dead");
			},
		};
		await expect(
			dictatePipeline(failing, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS),
		).rejects.toThrow("mic dead");
	});

	it("falls back to the raw transcript when the conversion is empty", async () => {
		const emptyProvider: VoiceProvider = {
			...fakeProvider,
			convertToLatex: async () => ({ text: "  " }),
		};
		const { output } = await dictatePipeline(emptyProvider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(output).toBe("transcribed d.m4a");
	});

	it("falls back to the raw transcript when the conversion is a meta response", async () => {
		const metaProvider: VoiceProvider = {
			...fakeProvider,
			convertToLatex: async () => ({
				text: "No se ha dictado ninguna expresión matemática ni texto explicativo en esta entrada. Por favor, proporcione el dictado.",
			}),
		};
		const { output } = await dictatePipeline(metaProvider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(output).toBe("transcribed d.m4a");
	});

	it("rejects silence-hallucination transcripts without calling the model", async () => {
		for (const ghost of ["", "   ", "...", "Gracias", "gracias!", "Subtitulos por Amara.org"]) {
			const convert = vi.fn(async () => ({ text: "converted" }));
			const ghostProvider: VoiceProvider = {
				...fakeProvider,
				transcribe: async () => ({ text: ghost }),
				convertToLatex: convert,
			};
			await expect(
				dictatePipeline(ghostProvider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS),
			).rejects.toThrow("empty transcript");
			expect(convert).not.toHaveBeenCalled();
		}
	});

	it("rewrites dictated enumerations as 1) 2) 3) lists", async () => {
		const listProvider: VoiceProvider = {
			...fakeProvider,
			convertToLatex: async () => ({ text: "1. El primero es la respuesta de estado cero\n2. El segundo es la respuesta de entrada cero" }),
		};
		const { output } = await dictatePipeline(listProvider, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS);
		expect(output).toBe("1) El primero es la respuesta de estado cero\n2) El segundo es la respuesta de entrada cero");
	});

	it("leaves a single numbered line untouched", async () => {
		const singleProvider: VoiceProvider = {
			...fakeProvider,
			convertToLatex: async () => ({ text: "1. Introducción" }),
		};
		const { output } = await dictatePipeline(singleProvider, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS);
		expect(output).toBe("1. Introducción");
	});

	it("forwards the abort signal to both provider calls", async () => {
		const controller = new AbortController();
		const seen: Array<AbortSignal | undefined> = [];
		const p: VoiceProvider = {
			...fakeProvider,
			transcribe: async (_audio, _filename, opts) => {
				seen.push(opts.signal);
				return { text: "t" };
			},
			convertToLatex: async (_transcript, opts) => {
				seen.push(opts.signal);
				return { text: "c" };
			},
		};
		await dictatePipeline(p, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS, {
			signal: controller.signal,
		});
		expect(seen).toEqual([controller.signal, controller.signal]);
	});

	it("uses opts.audioSeconds when the provider omits a duration", async () => {
		const p: VoiceProvider = {
			...fakeProvider,
			transcribe: async () => ({ text: "t" }),
			convertToLatex: async () => ({ text: "c" }),
		};
		const { usage } = await dictatePipeline(p, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS, {
			audioSeconds: 7,
		});
		expect(usage.audioSeconds).toBe(7);
	});

	it("reports the raw transcript before conversion completes", async () => {
		const seen: string[] = [];
		const p: VoiceProvider = {
			...fakeProvider,
			transcribe: async () => {
				seen.push("transcribe");
				return { text: "hola mundo" };
			},
			convertToLatex: async () => {
				seen.push("convert");
				return { text: "c" };
			},
		};
		let got: string | undefined;
		await dictatePipeline(p, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS, {
			onTranscript: (transcript) => {
				got = transcript;
				seen.push("transcript");
			},
		});
		expect(got).toBe("hola mundo");
		expect(seen).toEqual(["transcribe", "transcript", "convert"]);
	});

	it("does not report a transcript when transcription fails", async () => {
		const failing: VoiceProvider = {
			...fakeProvider,
			transcribe: async () => {
				throw new Error("mic dead");
			},
		};
		const onTranscript = vi.fn();
		await expect(
			dictatePipeline(failing, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS, { onTranscript }),
		).rejects.toThrow("mic dead");
		expect(onTranscript).not.toHaveBeenCalled();
	});

	it("reports each stage through onStep before it runs", async () => {
		const seen: string[] = [];
		const p: VoiceProvider = {
			...fakeProvider,
			transcribe: async () => {
				seen.push("transcribe");
				return { text: "t" };
			},
			convertToLatex: async () => {
				seen.push("convert");
				return { text: "c" };
			},
		};
		await dictatePipeline(p, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS, {
			onStep: (step) => seen.push(step),
		});
		expect(seen).toEqual(["transcribing", "transcribe", "converting", "convert"]);
	});
});

describe("0.5.10 guards", () => {
	it("returns a bare marker for command-only dictation without calling the model", async () => {
		let converted = false;
		const provider: VoiceProvider = {
			...fakeProvider,
			async transcribe() {
				return { text: "poneme un subtítulo", durationSeconds: 1 };
			},
			async convertToLatex(t, o) {
				converted = true;
				return fakeProvider.convertToLatex(t, o);
			},
		};
		const { output } = await dictatePipeline(provider, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS);
		expect(output).toBe("## ");
		expect(converted).toBe(false);
	});

	it("strips leading ellipsis before converting", async () => {
		let seen = "";
		const provider: VoiceProvider = {
			...fakeProvider,
			async transcribe() {
				return { text: "...sea bastante difícil", durationSeconds: 1 };
			},
			async convertToLatex(t, o) {
				seen = t;
				return fakeProvider.convertToLatex(t, o);
			},
		};
		await dictatePipeline(provider, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS);
		expect(seen).toBe("sea bastante difícil");
	});

	it("falls back to the raw transcript when conversion returns a meta message", async () => {
		const provider: VoiceProvider = {
			...fakeProvider,
			async transcribe() {
				return { text: "ruido ambiente", durationSeconds: 1 };
			},
			async convertToLatex() {
				return { text: "No se ha dictado ninguna expresión matemática." };
			},
		};
		const { output } = await dictatePipeline(provider, new Blob(["a"]), "d.m4a", CONVERT_SETTINGS);
		expect(output).toBe("ruido ambiente");
	});
});

describe("convertImageToLatex", () => {
	it("posts the image to the worker vision route", async () => {
		const { convertImageToLatex } = await import("../src/pipeline");
		let called = "";
		vi.stubGlobal("fetch", vi.fn(async (url: string) => {
			called = url;
			return new Response(JSON.stringify({ text: "$$P(s)$$" }), { status: 200 });
		}));
		try {
			const out = await convertImageToLatex("aGVsbG8=", {
				...CONVERT_SETTINGS,
				improveEnabled: true,
			});
			expect(out).toBe("$$P(s)$$");
			expect(called).toBe(`${DEFAULT_SETTINGS.improveUrl}/vision`);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("returns null when the toggle is off or the worker fails", async () => {
		const { convertImageToLatex } = await import("../src/pipeline");
		expect(await convertImageToLatex("aGVsbG8=", DEFAULT_SETTINGS)).toBeNull();
		vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
		try {
			expect(await convertImageToLatex("aGVsbG8=", { ...CONVERT_SETTINGS, improveEnabled: true })).toBeNull();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("conversion speed", () => {
	it("skips the model for plain prose without math or format", async () => {
		let converted = false;
		const provider: VoiceProvider = {
			...fakeProvider,
			async transcribe() {
				return { text: "esta noche tengo que estudiar para el parcial", durationSeconds: 1 };
			},
			async convertToLatex(t, o) {
				converted = true;
				return fakeProvider.convertToLatex(t, o);
			},
		};
		const { output } = await dictatePipeline(provider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(output).toBe("esta noche tengo que estudiar para el parcial");
		expect(converted).toBe(false);
	});

	it("still converts math, format words, digits and paragraph markers", async () => {
		const { needsConversion } = await import("../src/pipeline");
		expect(needsConversion("integral de equis al cuadrado")).toBe(true);
		expect(needsConversion("esto es un subtitulo")).toBe(true);
		expect(needsConversion("son las 3 de la mañana")).toBe(true);
		expect(needsConversion("primer paso barra barra segundo paso")).toBe(false);
		expect(needsConversion("a // b")).toBe(true);
		expect(needsConversion("el criterio de estabilidad del sistema")).toBe(false);
	});

	it("honors alwaysConvert to force the model on prose", async () => {
		let converted = false;
		const provider: VoiceProvider = {
			...fakeProvider,
			async transcribe() {
				return { text: "esta noche tengo que estudiar", durationSeconds: 1 };
			},
			async convertToLatex(t, o) {
				converted = true;
				return fakeProvider.convertToLatex(t, o);
			},
		};
		await dictatePipeline(provider, new Blob(["a"]), "d.m4a", { ...DEFAULT_SETTINGS, alwaysConvert: true });
		expect(converted).toBe(true);
	});

	it("caps max_tokens from the transcript length", async () => {
		const { conversionMaxTokens } = await import("../src/pipeline");
		expect(conversionMaxTokens("hola")).toBe(128);
		expect(conversionMaxTokens("x".repeat(200))).toBe(400);
		expect(conversionMaxTokens("x".repeat(5000))).toBe(1024);
		let seen = 0;
		const provider: VoiceProvider = {
			...fakeProvider,
			async transcribe() {
				return { text: "integral de equis", durationSeconds: 1 };
			},
			async convertToLatex(t, o) {
				seen = o.maxTokens ?? 0;
				return fakeProvider.convertToLatex(t, o);
			},
		};
		await dictatePipeline(provider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(seen).toBe(128);
	});
});

describe("cleanVisionLatex", () => {
	it("strips the model preamble and keeps the latex", () => {
		expect(cleanVisionLatex("The equation is:\n\n$$x = 1$$")).toBe("$$x = 1$$");
	});

	it("unwraps fenced latex blocks", () => {
		expect(cleanVisionLatex("```latex\n\\frac{a}{b}\n```")).toBe("\\frac{a}{b}");
	});

	it("returns null for empty and meta responses", () => {
		expect(cleanVisionLatex("   ")).toBeNull();
	});

	it("unwraps a full latex document down to its body", () => {
		expect(
			cleanVisionLatex("\\documentclass{article}\n\\begin{document}\n\\frac{a}{b}\n\\end{document}"),
		).toBe("\\frac{a}{b}");
	});
});
