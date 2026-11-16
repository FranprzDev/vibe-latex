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
	const m = t.match(/^(?:poneme|pone|haceme|hace|crea|crear|esto es|es)?\s*(?:un|una|de)?\s*(titulo|subtitulo|negrita|cursiva|codigo|cita)$/);
	if (m) return FORMAT_MARKERS[m[1]] ?? null;
	const lm = t.match(/^(?:poneme|pone|haceme|hace|crea|crear|esto es|es)?\s*(?:un|una|de)?\s*lista(?:\s+(numerada|enumerada|ordenada|desordenada))?$/);
	if (lm) {
		const q = lm[1];
		if (q === "desordenada") return "- ";
		if (q === undefined) return "- ";
		return "1) ";
	}
	return null;
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


function isCodeFence(line: string): boolean {
	return /^\s*```/.test(line) || /^\s*~~~/.test(line);
}

function isMathFenceOpen(line: string): boolean {
	return /^\s*\$\$\s*$/.test(line) || /^\s*\\\[\s*$/.test(line);
}

function isMathFenceClose(line: string): boolean {
	return /^\s*\$\$\s*$/.test(line) || /^\s*\\\]\s*$/.test(line);
}



function normalizeLabel(s: string): string {
	return s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
}

function isSoundLabel(content: string): boolean {
	const n = normalizeLabel(content);
	if (!n) return false;
	const exact = new Set([
		"music", "sound", "audio", "noise", "applause", "laughter", "laughing", "sigh",
		"cough", "playing", "instrumental", "jingle", "ringtone", "tone", "♪",
		"musica", "sonido", "ruido", "aplausos", "risas", "tos", "bam", "silencio", "silence",
	]);
	if (exact.has(n)) return true;
	if (/^(sound|sonido)\s+(of|de)\s+.+$/.test(n)) return true;
	if (n === "music playing") return true;
	if (/^(music|audio|sound)\s+(playing|effect|effects)$/.test(n)) return true;
	return false;
}

function removeAnnotationsFromLine(line: string): string {
	const placeholders: string[] = [];
	let s = line.replace(/`[^`]*`/g, (m) => {
		placeholders.push(m);
		return `\u0000${placeholders.length - 1}\u0000`;
	});
	s = s.replace(/\$[^$]*\$/g, (m) => {
		placeholders.push(m);
		return `\u0000${placeholders.length - 1}\u0000`;
	});
	s = s.replace(/(?<!\!)[ \t]?\[[^\]]*\](?![ \t]*\()[ \t]?/g, (m) => {
		const cm = m.match(/\[([^\]]*)\]/);
		const content = cm ? cm[1] : "";
		return isSoundLabel(content) ? " " : m;
	});
	s = s.replace(/(?<!\])[ \t]?\([^)]*\)[ \t]?/g, (m) => {
		const cm = m.match(/\(([^)]*)\)/);
		const content = cm ? cm[1] : "";
		return isSoundLabel(content) ? " " : m;
	});
	s = s.replace(/♪+/g, "");
	s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
	return s.replace(/[ \t]+$/, "");
}

export function dedentProse(text: string): string {
	if (hasCodeOrMathFence(text)) return text;
	const lines = text.split("\n");
	const out: string[] = [];
	let para: string[] = [];
	const flush = () => {
		if (para.length === 0) return;
		const preserve = paragraphHasPreserve(para);
		for (const l of para) {
			out.push(preserve ? l : l.replace(/^[ \u00A0]{1,3}/, ""));
		}
		para = [];
	};
	for (const line of lines) {
		if (line.trim() === "") {
			flush();
			out.push(line);
		} else {
			para.push(line);
		}
	}
	flush();
	return out.join("\n");
}

function hasCodeOrMathFence(text: string): boolean {
	return text.split("\n").some((line) =>
		/```|~~~/.test(line) ||
		/^\s*\$\$\s*$/.test(line) ||
		/^\s*\\\[\s*$/.test(line) ||
		/^\s*\\\]\s*$/.test(line)
	);
}

function paragraphHasPreserve(lines: string[]): boolean {
	for (const line of lines) {
		if (/```|~~~/.test(line)) return true;
		if (/^\s*([-*+]|\d+[.)])\s/.test(line)) return true;
		if (/^\s*>/.test(line)) return true;
		if (/\$\$/.test(line) || /\\\[/.test(line) || /\\\]/.test(line) || /\\\(/.test(line) || /\\\)/.test(line) || /\\begin\{/.test(line) || /\\end\{/.test(line)) return true;
		if (/^\s*\$.*\$\s*$/.test(line)) return true;
		if (/^( {4,}|\t)/.test(line)) return true;
	}
	return false;
}

export function stripBracketedAnnotations(text: string): string {
	const lines = text.split("\n");
	let inCode = false;
	let inMath = false;
	return lines
		.map((line) => {
			if (isCodeFence(line)) {
				inCode = !inCode;
				return line;
			}
			if (inCode) return line;
			if (!inMath && isMathFenceOpen(line)) {
				inMath = true;
				return line;
			}
			if (inMath) {
				if (isMathFenceClose(line)) inMath = false;
				return line;
			}
			return removeAnnotationsFromLine(line);
		})
		.join("\n");
}

export const normalizeProseIndentation = dedentProse;
export const stripSoundAnnotations = stripBracketedAnnotations;
export const cleanText = (t: string) => stripBracketedAnnotations(dedentProse(t));
