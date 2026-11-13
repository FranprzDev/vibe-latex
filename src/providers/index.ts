import { VoiceProvider } from "./provider";
import { OpenAIProvider } from "./openai";
import { LocalProvider } from "./local";
import { LatexVoiceSettings } from "../settings";

export function createProvider(settings: LatexVoiceSettings): VoiceProvider {
	switch (settings.providerId) {
		case "local":
			return new LocalProvider({
				transcriptionBaseUrl: settings.transcriptionBaseUrl,
				conversionBaseUrl: settings.conversionBaseUrl,
				transcriptionModel: settings.transcriptionModel,
				conversionModel: settings.conversionModel,
			});
		case "openai":
		default:
			return new OpenAIProvider({
				apiKey: settings.openaiApiKey,
				transcriptionBaseUrl: settings.transcriptionBaseUrl,
				conversionBaseUrl: settings.conversionBaseUrl,
				transcriptionModel: settings.transcriptionModel,
				conversionModel: settings.conversionModel,
			});
	}
}

export type { VoiceProvider, TranscribeOptions, ConvertOptions } from "./provider";
