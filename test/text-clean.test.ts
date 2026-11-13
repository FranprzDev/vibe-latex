import { describe, it, expect } from "vitest";
import {
	cleanPdfText,
	formatCommandOnly,
	stitchFragment,
	stripLeadingEllipsis,
	trailingEllipsisLength,
} from "../src/text-clean";

describe("formatCommandOnly", () => {
	it("detects bare format commands", () => {
		expect(formatCommandOnly("poneme un subtítulo")).toBe("## ");
		expect(formatCommandOnly("Poneme un subtítulo.")).toBe("## ");
		expect(formatCommandOnly("un título")).toBe("# ");
		expect(formatCommandOnly("haceme una lista")).toBe("- ");
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
