export interface Env {
	AI: Ai;
}

const SYSTEM_PROMPT = `Sos un corrector de términos técnicos mal transcriptos en notas de estudio en español (ingeniería, matemática, control, física).
Reglas estrictas:
- Corregí ÚNICAMENTE palabras o términos que claramente son errores de transcripción de voz (por ejemplo "route hardware" → "Routh-Hurwitz", "ny quist" → "Nyquist").
- NUNCA agregues contenido: ni definiciones, ejemplos, explicaciones, títulos ni fórmulas que no estén en el texto original.
- Conservá exactamente el formato Markdown y las fórmulas LaTeX ($...$, $$...$$) sin modificarlas.
- Si el texto no tiene errores de transcripción, devolvelo idéntico.
- Devolvé únicamente el texto corregido, sin comentarios ni explicaciones.`;

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS });
		}
		if (request.method !== "POST") {
			return new Response("method not allowed", { status: 405, headers: CORS });
		}
		let original = "";
		try {
			const body = (await request.json()) as { text?: string };
			original = typeof body.text === "string" ? body.text : "";
		} catch {
			original = "";
		}
		if (!original.trim()) {
			return Response.json({ text: original }, { headers: CORS });
		}
		try {
			const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{ role: "user", content: original.slice(0, 4000) },
				],
				max_tokens: 1500,
			});
			const improved = (result as { response?: string }).response?.trim();
			return Response.json({ text: improved || original }, { headers: CORS });
		} catch {
			return Response.json({ text: original }, { headers: CORS });
		}
	},
};
