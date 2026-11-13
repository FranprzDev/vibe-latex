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

const VISION_PROMPT = `Transcribí la fórmula matemática de la imagen a LaTeX, completa, incluyendo el lado izquierdo si aparece (por ejemplo P(s) = ...). Devolvé ÚNICAMENTE el código LaTeX, entre $...$ si es en línea o $$...$$ si es destacada. Si hay texto que no es fórmula, transcribilo como texto plano breve. Sin explicaciones, sin comentarios, sin texto adicional.`;

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

async function handleVision(request: Request, env: Env): Promise<Response> {
	let imageB64 = "";
	try {
		const body = (await request.json()) as { image?: string };
		imageB64 = typeof body.image === "string" ? body.image : "";
	} catch {
		imageB64 = "";
	}
	if (!imageB64) {
		return Response.json({ error: "missing image" }, { status: 400, headers: CORS });
	}
	try {
		const result = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
			prompt: VISION_PROMPT,
			image: [...base64ToBytes(imageB64)],
			max_tokens: 512,
		});
		const r = result as { description?: string; response?: string };
		const text = (r.description ?? r.response ?? "").trim();
		return Response.json({ text }, { headers: CORS });
	} catch (e) {
		return Response.json({ text: "", debug: String(e) }, { headers: CORS });
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS });
		}
		if (request.method !== "POST") {
			return new Response("method not allowed", { status: 405, headers: CORS });
		}
		if (new URL(request.url).pathname === "/vision") {
			return handleVision(request, env);
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
