import { describe, it, expect, vi } from "vitest";
import {
	createFeedbackReport,
	diagnoseFeedback,
	serializeFeedback,
	FEEDBACK_DIAGNOSIS_SYSTEM_PROMPT,
} from "../src/feedback";

describe("createFeedbackReport", () => {
	it("shape", () => {
		const r = createFeedbackReport("desc", "1.2.3");
		expect(r.schemaVersion).toBe(1);
		expect(typeof r.id).toBe("string");
		expect(typeof r.createdAt).toBe("string");
		expect(r.pluginVersion).toBe("1.2.3");
		expect(r.description).toBe("desc");
		expect(r.status).toBe("open");
		expect(r.context).toBeUndefined();
	});

	it("context opt-in", () => {
		const ctx = { transcript: "t", output: "o", error: "e" };
		const off = createFeedbackReport("desc", "v", ctx, false);
		expect(off.context).toBeUndefined();
		const on = createFeedbackReport("desc", "v", ctx, true);
		expect(on.context).toEqual(ctx);
	});

	it("empty rejection", () => {
		expect(() => createFeedbackReport("", "v")).toThrow();
		expect(() => createFeedbackReport("   ", "v")).toThrow();
	});

	it("bounds", () => {
		const longDesc = "x".repeat(9000);
		const r = createFeedbackReport(longDesc, "v");
		expect(r.description.length).toBe(8000);
		const longCtx = { transcript: "a".repeat(13000), output: "b".repeat(13000), error: "c".repeat(13000) };
		const rc = createFeedbackReport("d", "v", longCtx, true);
		expect(rc.context!.transcript.length).toBe(12000);
		expect(rc.context!.output.length).toBe(12000);
		expect(rc.context!.error!.length).toBe(12000);
	});

	it("trims", () => {
		const r = createFeedbackReport("  hi  ", "v");
		expect(r.description).toBe("hi");
	});

	it("uuid and iso", () => {
		const r = createFeedbackReport("d", "v");
		expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(() => new Date(r.createdAt).toISOString()).not.toThrow();
	});
});

describe("diagnoseFeedback", () => {
	it("provider args/system prompt", async () => {
		const provider = { convertToLatex: vi.fn().mockResolvedValue({ text: "  diag  " }) } as any;
		const report = createFeedbackReport("desc", "1.0", { transcript: "t", output: "o", error: "e" }, true);
		const signal = new AbortController().signal;
		const out = await diagnoseFeedback(provider, report, signal);
		expect(out).toBe("diag");
		expect(report.diagnosis).toBe("diag");
		const [transcript, opts] = provider.convertToLatex.mock.calls[0];
		expect(JSON.parse(transcript)).toEqual({
			description: "desc",
			context: report.context,
			version: "1.0",
		});
		expect(opts.maxTokens).toBe(1024);
		expect(opts.signal).toBe(signal);
		expect(typeof opts.systemPrompt).toBe("string");
		expect(opts.systemPrompt).toContain("hipótesis");
		expect(opts.systemPrompt).toContain("hechos");
		expect(opts.systemPrompt).toContain("reproducción");
		expect(opts.systemPrompt).toContain("verificación");
		expect(opts.systemPrompt).toContain("arreglado");
		expect(opts.systemPrompt).toContain("entrenado");
		expect(opts.systemPrompt).toContain("secretos");
		expect(opts.systemPrompt).toContain("suministrados");
	});
	it("caps result", async () => {
		const provider = { convertToLatex: vi.fn().mockResolvedValue({ text: "x".repeat(13000) }) } as any;
		const report = createFeedbackReport("d", "v");
		const out = await diagnoseFeedback(provider, report);
		expect(out.length).toBe(12000);
	});

	it("throws AbortError when signal already aborted", async () => {
		const provider = { convertToLatex: vi.fn() } as any;
		const report = createFeedbackReport("d", "v");
		const controller = new AbortController();
		controller.abort();
		await expect(diagnoseFeedback(provider, report, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(provider.convertToLatex).not.toHaveBeenCalled();
		expect(report.diagnosis).toBeUndefined();
	});

	it("ignores provider response when aborted", async () => {
		const controller = new AbortController();
		const provider = {
			convertToLatex: vi.fn().mockImplementation(async () => {
				controller.abort();
				return { text: "diag" };
			}),
		} as any;
		const report = createFeedbackReport("d", "v");
		await expect(diagnoseFeedback(provider, report, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(report.diagnosis).toBeUndefined();
	});

	it("rejects empty diagnosis", async () => {
		const provider = { convertToLatex: vi.fn().mockResolvedValue({ text: "   " }) } as any;
		const report = createFeedbackReport("d", "v");
		await expect(diagnoseFeedback(provider, report)).rejects.toThrow("No se pudo diagnosticar.");
		expect(report.diagnosis).toBeUndefined();
	});
});

describe("serializeFeedback", () => {
	it("readable json + newline", () => {
		const r = createFeedbackReport("d", "v");
		const s = serializeFeedback(r);
		expect(s.endsWith("\n")).toBe(true);
		expect(JSON.parse(s)).toEqual(r);
	});
});

describe("no settings leakage", () => {
	it("report has no settings/paths/audio", () => {
		const r = createFeedbackReport("d", "v", { transcript: "t", output: "o" }, true);
		const keys = Object.keys(r);
		expect(keys).not.toContain("settings");
		expect(keys).not.toContain("apiKey");
		expect(JSON.stringify(r)).not.toContain("sk-");
	});
});

describe("data bounds (deterministic)", () => {
	it("trims then caps description", () => {
		const r = createFeedbackReport("   " + "x".repeat(9000) + "   ", "v");
		expect(r.description).toBe("x".repeat(8000));
		expect(r.description.length).toBe(8000);
	});

	it("caps each context field independently", () => {
		const ctx = { transcript: "  " + "a".repeat(13000) + "  ", output: "b".repeat(5), error: "c".repeat(12001) };
		const r = createFeedbackReport("d", "v", ctx, true);
		expect(r.context!.transcript).toBe("a".repeat(12000));
		expect(r.context!.output).toBe("b".repeat(5));
		expect(r.context!.error).toBe("c".repeat(12000));
	});

	it("omits context when not included", () => {
		const r = createFeedbackReport("d", "v", { transcript: "t", output: "o" }, false);
		expect(r.context).toBeUndefined();
	});

	it("omits error when undefined", () => {
		const r = createFeedbackReport("d", "v", { transcript: "t", output: "o" }, true);
		expect(r.context!.error).toBeUndefined();
	});

	it("rejects non-string description", () => {
		expect(() => createFeedbackReport(42 as unknown as string, "v")).toThrow();
	});

	it("diagnosis capped at 12000", async () => {
		const provider = { convertToLatex: vi.fn().mockResolvedValue({ text: "y".repeat(15000) }) } as any;
		const report = createFeedbackReport("d", "v");
		const out = await diagnoseFeedback(provider, report);
		expect(out.length).toBe(12000);
		expect(report.diagnosis?.length).toBe(12000);
	});

	it("serialize round-trips", () => {
		const r = createFeedbackReport("d", "v");
		const s = serializeFeedback(r);
		expect(JSON.parse(s)).toEqual(r);
		expect(s.endsWith("\n")).toBe(true);
	});
});
