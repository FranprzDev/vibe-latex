export interface GlossaryEntry {
	wrong: string;
	right: string;
}

export const DEFAULT_GLOSSARY: GlossaryEntry[] = [
	{ wrong: "route hardware", right: "Routh-Hurwitz" },
	{ wrong: "route hurwitz", right: "Routh-Hurwitz" },
	{ wrong: "raus hurwitz", right: "Routh-Hurwitz" },
	{ wrong: "ny quist", right: "Nyquist" },
	{ wrong: "bodi", right: "Bode" },
	{ wrong: "laplas", right: "Laplace" },
	{ wrong: "furier", right: "Fourier" },
	{ wrong: "forier", right: "Fourier" },
];

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseGlossaryLines(lines: string[]): GlossaryEntry[] {
	const entries: GlossaryEntry[] = [];
	for (const line of lines) {
		const i = line.indexOf("=");
		if (i < 1) continue;
		const wrong = line.slice(0, i).trim();
		const right = line.slice(i + 1).trim();
		if (wrong && right) entries.push({ wrong, right });
	}
	return entries;
}

export function glossaryToLines(entries: GlossaryEntry[]): string[] {
	return entries.map((e) => `${e.wrong} = ${e.right}`);
}

export function applyGlossary(text: string, entries: GlossaryEntry[]): string {
	let out = text;
	for (const { wrong, right } of entries) {
		out = out.replace(new RegExp(`\\b${escapeRegExp(wrong)}\\b`, "gi"), right);
	}
	return out;
}
