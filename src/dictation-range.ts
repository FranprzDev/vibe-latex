export interface DictationRange {
	filePath: string;
	from: number;
	to: number;
	text: string;
}

export function verifiedDictationRange(
	content: string,
	range: DictationRange,
): Pick<DictationRange, "from" | "to"> | null {
	return content.slice(range.from, range.to) === range.text
		? { from: range.from, to: range.to }
		: null;
}

export function dictationReplacementText(
	output: string,
	selection: string,
	existingText?: string,
): string {
	const keepLineBreak = existingText !== undefined
		? existingText.endsWith("\n")
		: selection.length === 0 || selection.endsWith("\n");
	return output + (keepLineBreak ? "\n" : "");
}

export function extendDictationRange(
	session: Pick<DictationRange, "filePath" | "from" | "to"> | null,
	filePath: string,
	from: number,
	to: number,
): Pick<DictationRange, "filePath" | "from" | "to"> {
	if (!session || session.filePath !== filePath) return { filePath, from, to };
	return { filePath, from: Math.min(session.from, from), to: Math.max(session.to, to) };
}
