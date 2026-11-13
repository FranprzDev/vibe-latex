/**
 * Maps technical errors to short, user-friendly Spanish messages.
 */
export function friendlyError(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	const lower = msg.toLowerCase();

	if (lower.includes("audio decode timeout"))
		return "No pude decodificar el audio del micrófono. Probá de nuevo o reiniciá Obsidian.";
	if (lower.includes("401") || lower.includes("invalid api key") || lower.includes("unauthorized"))
		return "Clave API inválida. Revisala en Ajustes → Vibe LaTeX.";
	if (lower.includes("429") || lower.includes("rate limit"))
		return "Límite de la API alcanzado. Esperá un momento.";
	if (lower.includes("402") || lower.includes("insufficient") || lower.includes("billing"))
		return "Sin crédito en la cuenta de la API.";
	if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("signal timed out"))
		return "Tardó demasiado. Si es la primera vez, el modelo puede seguir cargando; probá de nuevo.";
	if (lower.includes("failed to fetch") || lower.includes("load failed"))
		return "No responde el servidor. Si usás el modo local, revisá que esté iniciado en Ajustes → Vibe LaTeX.";
	if (lower.includes("fetch") || lower.includes("network") || lower.includes("enotfound") || lower.includes("econnrefused"))
		return "Sin conexión. Revisá tu internet.";
	if (lower.includes("notallowed") || lower.includes("permission") || lower.includes("mic"))
		return "Sin permiso de micrófono. Habilitalo en los ajustes de privacidad del dispositivo.";
	if (lower.includes("not recording"))
		return "No hay grabación activa.";
	if (lower.includes("no active") || lower.includes("markdown"))
		return "Abrí una nota antes de dictar.";
	if (lower.includes("empty transcript"))
		return "No detecté voz. Revisá que el micrófono funcione y el permiso esté dado.";
	if (lower.includes("empty conversion"))
		return "No pude convertir el dictado. Probá repetirlo.";
	if (lower.includes("transcription failed"))
		return "No se pudo transcribir el audio. Revisá el modelo y el servicio configurados.";
	if (lower.includes("conversion failed"))
		return "No se pudo convertir el dictado. Revisá el modelo y el servicio configurados.";

	// fallback: first line, trimmed
	return msg.split("\n")[0].slice(0, 120);
}
