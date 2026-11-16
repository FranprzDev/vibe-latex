export class TypingGuard {
  private static readonly IDLE_THRESHOLD_MS = 600;

  private lastTyping: number; private composing = false;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.lastTyping = 0;
  }

  setComposing(value: boolean): void { this.composing = value; this.markTyping(); }

  markTyping(): void {
    this.lastTyping = this.now();
  }

  async waitUntilIdle(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    while (this.composing || this.now() - this.lastTyping < TypingGuard.IDLE_THRESHOLD_MS) {
      await this.sleep(
        80 + Math.floor(Math.random() * 200),
        signal,
      );
    }
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
