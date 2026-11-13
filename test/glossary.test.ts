import { describe, it, expect } from "vitest";
import {
	applyGlossary,
	glossaryToLines,
	parseGlossaryLines,
	DEFAULT_GLOSSARY,
} from "../src/glossary";

describe("glossary", () => {
	it("parses wrong = right lines and skips junk", () => {
		expect(parseGlossaryLines(["route hardware = Routh-Hurwitz", "", "noequals", " = x"])).toEqual([
			{ wrong: "route hardware", right: "Routh-Hurwitz" },
		]);
	});

	it("round-trips through lines", () => {
		expect(parseGlossaryLines(glossaryToLines(DEFAULT_GLOSSARY))).toEqual(DEFAULT_GLOSSARY);
	});

	it("replaces case-insensitively on word boundaries", () => {
		const out = applyGlossary("El criterio de Route Hardware y route hardware", DEFAULT_GLOSSARY);
		expect(out).toBe("El criterio de Routh-Hurwitz y Routh-Hurwitz");
	});

	it("does not replace inside words", () => {
		const out = applyGlossary("foriero distinto", DEFAULT_GLOSSARY);
		expect(out).toBe("foriero distinto");
	});
});
