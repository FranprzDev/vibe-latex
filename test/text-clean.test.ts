import { describe, it, expect } from "vitest";
import {
	cleanPdfText,
	dedentProse,
	formatCommandOnly,
	normalizeProseIndentation,
	stitchFragment,
	stripBracketedAnnotations,
	stripLeadingEllipsis,
	stripSoundAnnotations,
	trailingEllipsisLength,
} from "../src/text-clean";

describe("formatCommandOnly", () => {
	it("detects bare format commands", () => {
		expect(formatCommandOnly("poneme un subtítulo")).toBe("## ");
		expect(formatCommandOnly("Poneme un subtítulo.")).toBe("## ");
		expect(formatCommandOnly("un título")).toBe("# ");
		expect(formatCommandOnly("haceme una lista")).toBe("- ");
	expect(formatCommandOnly("lista numerada")).toBe("1) ");
	expect(formatCommandOnly("lista desordenada")).toBe("- ");
		expect(formatCommandOnly("negrita")).toBe("**");
		expect(formatCommandOnly("esto es una cita")).toBe("> ");
	});

	it("returns null for real content", () => {
		expect(formatCommandOnly("el subtítulo del capítulo dos es importante")).toBeNull();
		expect(formatCommandOnly("integral de x al cuadrado")).toBeNull();
	});
});

describe("fragment stitching", () => {
	it("strips leading ellipsis from transcripts", () => {
		expect(stripLeadingEllipsis("...sea bastante difícil")).toBe("sea bastante difícil");
		expect(stripLeadingEllipsis("… las raíces")).toBe("las raíces");
		expect(stripLeadingEllipsis("texto normal")).toBe("texto normal");
	});

	it("stitches a fragment onto a trailing ellipsis", () => {
		expect(stitchFragment("O...", "...sea difícil")).toBe("O sea difícil");
		expect(stitchFragment("sin corte", "...nuevo")).toBe("nuevo");
	});

	it("measures a trailing ellipsis before the cursor", () => {
		expect(trailingEllipsisLength("las raíces del...")).toBe(3);
		expect(trailingEllipsisLength("corte … ")).toBe(2);
		expect(trailingEllipsisLength("completo.")).toBe(0);
	});
});

describe("cleanPdfText", () => {
	it("joins hyphenated words and single line breaks", () => {
		expect(cleanPdfText("transfor-\nmada de\nLaplace")).toBe("transformada de Laplace");
	});

	it("keeps paragraph breaks", () => {
		expect(cleanPdfText("uno\n\ndos")).toBe("uno\n\ndos");
	});
});

describe("dedentProse", () => {
	it("removes accidental indentation from prose", () => {
		expect(dedentProse("   Hola mundo\n   segunda linea")).toBe("Hola mundo\nsegunda linea");
	});

	it("preserves lists", () => {
		expect(dedentProse("    - item\n        - sub")).toBe("    - item\n        - sub");
	});

	it("preserves fenced code", () => {
		const input = "    texto\n```\n    code\n```\n    mas";
		expect(dedentProse(input)).toBe(input);
	});

	it("preserves math blocks", () => {
		const input = "    texto\n$$\n    x^2\n$$\n    mas";
		expect(dedentProse(input)).toBe(input);
	});
});

describe("stripBracketedAnnotations", () => {
	it("removes bracketed sound/music annotations", () => {
		expect(stripBracketedAnnotations("Hola [music] mundo")).toBe("Hola mundo");
		expect(stripBracketedAnnotations("Hi (music playing) bye")).toBe("Hi bye");
		expect(stripBracketedAnnotations("A [Sound of rain] B")).toBe("A B");
	});

	it("supports spanish labels", () => {
		expect(stripBracketedAnnotations("Hola [BAM] mundo")).toBe("Hola mundo");
		expect(stripBracketedAnnotations("Hola [Música] mundo")).toBe("Hola mundo");
		expect(stripBracketedAnnotations("Hola [Aplausos] mundo")).toBe("Hola mundo");
		expect(stripBracketedAnnotations("Hola [Sonido de la venta] mundo")).toBe("Hola mundo");
	});

	it("keeps markdown links and ordinary brackets", () => {
		expect(stripBracketedAnnotations("Ver [audio processing] texto")).toBe("Ver [audio processing] texto");
		expect(stripBracketedAnnotations("Link [music](https://example.com) here")).toBe("Link [music](https://example.com) here");
	});

	it("keeps non-sound brackets", () => {
		expect(stripBracketedAnnotations("Ver [1] y [nota]")).toBe("Ver [1] y [nota]");
	});

	it("preserves code and math", () => {
		expect(stripBracketedAnnotations("`[music]` y $[music]$")).toBe("`[music]` y $[music]$");
	});
});

describe("aliases", () => {
	it("exposes preferred aliases", () => {
		expect(normalizeProseIndentation).toBe(dedentProse);
		expect(stripSoundAnnotations).toBe(stripBracketedAnnotations);
	});
});
