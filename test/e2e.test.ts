import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { dictatePipeline } from "../src/pipeline";
import { OpenAIProvider } from "../src/providers/openai";
import {
	DEFAULT_SETTINGS,
	LatexVoiceSettings,
} from "../src/settings";

/**
 * Real end-to-end test: synthesized Spanish speech (macOS `say`) →
 * OpenAI transcription → LLM LaTeX conversion → regex assertions.
 *
 * Requires OPENAI_API_KEY (or OPENAI_API_KEY in .env). Skipped otherwise.
 */

const apiKey = process.env.OPENAI_API_KEY;
const run = apiKey ? describe : describe.skip;

const FIXTURES = join(__dirname, "fixtures");
const dictations: {
	file: string;
	subject: string;
	language: "es";
	dictated: string;
	mustMatch: string[];
}[] = JSON.parse(readFileSync(join(FIXTURES, "dictations.json"), "utf8"));

const subjects = [...new Set(dictations.map((d) => d.subject))];

function settingsFor(): LatexVoiceSettings {
	return {
		...DEFAULT_SETTINGS,
		openaiApiKey: apiKey ?? "",
	};
}

const provider = new OpenAIProvider({
	apiKey: apiKey ?? "",
	transcriptionBaseUrl: DEFAULT_SETTINGS.transcriptionBaseUrl,
	conversionBaseUrl: DEFAULT_SETTINGS.conversionBaseUrl,
	transcriptionModel: DEFAULT_SETTINGS.transcriptionModel,
	conversionModel: DEFAULT_SETTINGS.conversionModel,
});

run("e2e: dictation → LaTeX", { timeout: 300_000 }, () => {
	for (const subject of subjects) {
		describe(subject, () => {
			for (const d of dictations.filter((x) => x.subject === subject)) {
				it(`"${d.dictated}" produces expected LaTeX`, async () => {
			const audio = new Blob([readFileSync(join(FIXTURES, d.file))], {
				type: "audio/mp4",
			});
			const { transcript, output } = await dictatePipeline(
				provider,
				audio,
				d.file,
				settingsFor(),
			);
			console.log(`\n  transcript: ${transcript}\n  output: ${output}`);
			for (const pattern of d.mustMatch) {
				expect(output, `missing ${pattern}`).toMatch(new RegExp(pattern));
			}
				});
			}
		});
	}
});
