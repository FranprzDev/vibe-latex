const FORMAT_MARKERS: Record<string, string> = {
	titulo: "# ",
	subtitulo: "## ",
	lista: "- ",
	negrita: "**",
	cursiva: "*",
	codigo: "`",
	cita: "> ",
};

function normalize(s: string): string {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function formatCommandOnly(transcript: string): string | null {
	const t = normalize(transcript).replace(/[.!?,;:]+$/, "");
	const m = t.match(/^(?:poneme|pone|haceme|hace|crea|crear|esto es|es)?\s*(?:un|una|de)?\s*(titulo|subtitulo|lista|negrita|cursiva|codigo|cita)$/);
	if (!m) return null;
	return FORMAT_MARKERS[m[1]] ?? null;
}

export function stripLeadingEllipsis(text: string): string {
	return text.replace(/^\s*(?:\.\.\.|…)\s*/, "");
}

export function stripTrailingEllipsis(text: string): string {
	return text.replace(/\s*(?:\.\.\.|…)\s*$/, "");
}

export function stitchFragment(previous: string, next: string): string {
	const prev = previous.trimEnd();
	const body = stripLeadingEllipsis(next).trimStart();
	if (/(?:\.\.\.|…)$/.test(prev)) {
		return `${stripTrailingEllipsis(prev).trimEnd()} ${body}`.trim();
	}
	return body;
}

export function cleanPdfText(raw: string): string {
	return raw
		.replace(/\r\n?/g, "\n")
		.replace(/(\w)-\n(\w)/g, "$1$2")
		.replace(/([^\n])\n(?!\n)/g, "$1 ")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function trailingEllipsisLength(text: string): number {
	const m = text.match(/(?:\.\.\.|…)\s*$/);
	return m ? m[0].length : 0;
}
