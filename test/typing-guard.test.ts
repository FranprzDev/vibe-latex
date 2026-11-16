import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypingGuard } from "../src/typing-guard";

describe("TypingGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves immediately when idle", async () => {
    const guard = new TypingGuard();
    let resolved = false;

    guard.waitUntilIdle().then(() => {
      resolved = true;
    });

    await vi.runAllTimersAsync();

    expect(resolved).toBe(true);
  });

  it("delays until the idle threshold has passed after typing", async () => {
    const guard = new TypingGuard();
    guard.markTyping();
    let resolved = false;

    guard.waitUntilIdle().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(599);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(41);
    expect(resolved).toBe(true);
  });

  it("extends the wait when typing continues", async () => {
    const guard = new TypingGuard();
    guard.markTyping();
    let resolved = false;

    guard.waitUntilIdle().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(200);
    guard.markTyping();

    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(true);
  });

  it("rejects with AbortError when aborted", async () => {
    const guard = new TypingGuard();
    guard.markTyping();
    const controller = new AbortController();

    const promise = guard.waitUntilIdle(controller.signal);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });

    controller.abort();
    await assertion;
  });
});
