import { describe, it, expect } from "vitest";
import { friendlyError } from "../src/errors";

describe("friendlyError", () => {
	it("maps 401 to API key message", () => {
		expect(friendlyError(new Error("Invalid API key (HTTP 401)"))).toContain(
			"Clave API",
		);
	});
	it("maps 429 to rate limit", () => {
		expect(friendlyError(new Error("rate limit (HTTP 429)"))).toContain(
			"Límite",
		);
	});
	it("maps empty conversion to a Spanish retry message", () => {
		expect(friendlyError(new Error("empty conversion"))).toContain("repetirlo");
	});
	it("maps network failures", () => {
		expect(friendlyError(new Error("fetch failed: ENOTFOUND"))).toContain(
			"conexión",
		);
	});
	it("maps failed-to-fetch to the local server message", () => {
		expect(friendlyError(new Error("TypeError: Failed to fetch"))).toContain(
			"No responde el servidor",
		);
	});
	it("maps load failed to the local server message", () => {
		expect(friendlyError(new Error("Load failed"))).toContain(
			"No responde el servidor",
		);
	});
	it("maps timeouts to the loading-model message", () => {
		expect(friendlyError(new Error("The operation was aborted due to signal timed out"))).toContain(
			"Tardó demasiado",
		);
	});
	it("maps the audio decode timeout to the microphone message", () => {
		expect(friendlyError(new Error("audio decode timeout"))).toContain(
			"decodificar el audio",
		);
	});
	it("maps mic permission errors", () => {
		expect(
			friendlyError(new Error("NotAllowedError: permission denied")),
		).toContain("micrófono");
	});
	it("truncates unknown errors to a short first line", () => {
		const long = "x".repeat(500) + "\nsecond line";
		const out = friendlyError(new Error(long));
		expect(out.length).toBeLessThanOrEqual(120);
		expect(out).not.toContain("second line");
	});
	it("handles non-Error values", () => {
		expect(friendlyError("plain string 401")).toContain("Clave API");
	});
});
