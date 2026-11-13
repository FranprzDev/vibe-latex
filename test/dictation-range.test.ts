import { describe, expect, it } from "vitest";
import {
	dictationReplacementText,
	verifiedDictationRange,
	extendDictationRange,
} from "../src/dictation-range";
import { migrateSettings } from "../src/settings";

describe("verifiedDictationRange", () => {
	it("returns the saved range only while its dictated text is unchanged", () => {
		const range = { filePath: "nota.md", from: 3, to: 8, text: "abcde" };
		expect(verifiedDictationRange("hi abcde!", range)).toEqual({ from: 3, to: 8 });
		expect(verifiedDictationRange("hi abXde!", range)).toBeNull();
	});

	it("keeps working after a reload while the note is untouched", () => {
		const stored = {
			lastDictation: { filePath: "nota.md", from: 0, to: 5, text: "hola\n" },
		};
		const range = migrateSettings(stored).lastDictation;
		expect(range).not.toBeNull();
		expect(verifiedDictationRange("hola\nresto", range!)).toEqual({ from: 0, to: 5 });
		expect(verifiedDictationRange("hola! resto", range!)).toBeNull();
	});
});

describe("dictationReplacementText", () => {
	it("keeps line breaks for insertions and preserves the selected text shape", () => {
		expect(dictationReplacementText("nuevo", "")).toBe("nuevo\n");
		expect(dictationReplacementText("nuevo", "viejo")).toBe("nuevo");
		expect(dictationReplacementText("nuevo", "viejo\n")).toBe("nuevo\n");
		expect(dictationReplacementText("nuevo", "", "anterior\n")).toBe("nuevo\n");
	});
});

describe("extendDictationRange", () => {
	it("starts a new range when there is none", () => {
		expect(extendDictationRange(null, "a.md", 5, 10)).toEqual({ filePath: "a.md", from: 5, to: 10 });
	});

	it("extends across sequential inserts", () => {
		const first = extendDictationRange(null, "a.md", 5, 10);
		const second = extendDictationRange(first, "a.md", 10, 25);
		expect(second).toEqual({ filePath: "a.md", from: 5, to: 25 });
	});

	it("resets when the file changes", () => {
		const first = extendDictationRange(null, "a.md", 5, 10);
		expect(extendDictationRange(first, "b.md", 0, 4)).toEqual({ filePath: "b.md", from: 0, to: 4 });
	});
});
