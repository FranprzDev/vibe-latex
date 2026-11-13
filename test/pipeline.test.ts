import { describe, it, expect, vi } from "vitest";
import { dictatePipeline } from "../src/pipeline";
import { VoiceProvider } from "../src/providers";
import { DEFAULT_SETTINGS } from "../src/settings";

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
			DEFAULT_SETTINGS,
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
		const { output } = await dictatePipeline(listProvider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(output).toBe("1) El primero es la respuesta de estado cero\n2) El segundo es la respuesta de entrada cero");
	});

	it("leaves a single numbered line untouched", async () => {
		const singleProvider: VoiceProvider = {
			...fakeProvider,
			convertToLatex: async () => ({ text: "1. Introducción" }),
		};
		const { output } = await dictatePipeline(singleProvider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
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
		await dictatePipeline(p, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS, {
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
		const { usage } = await dictatePipeline(p, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS, {
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
		await dictatePipeline(p, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS, {
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
			dictatePipeline(failing, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS, { onTranscript }),
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
		await dictatePipeline(p, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS, {
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
		const { output } = await dictatePipeline(provider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(output).toBe("## ");
		expect(converted).toBe(false);
	});

	it("applies the glossary and strips leading ellipsis before converting", async () => {
		let seen = "";
		const provider: VoiceProvider = {
			...fakeProvider,
			async transcribe() {
				return { text: "...el criterio de route hardware", durationSeconds: 1 };
			},
			async convertToLatex(t, o) {
				seen = t;
				return fakeProvider.convertToLatex(t, o);
			},
		};
		await dictatePipeline(provider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(seen).toBe("el criterio de Routh-Hurwitz");
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
		const { output } = await dictatePipeline(provider, new Blob(["a"]), "d.m4a", DEFAULT_SETTINGS);
		expect(output).toBe("ruido ambiente");
	});
});
