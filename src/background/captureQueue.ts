interface Job { tabId: number; due: number; attempt: number }
type CaptureResult = 'done' | 'skip' | 'retry';

/** Serial, coalesced jobs. The capture function enforces the API interval. */
export class CaptureQueue {
  private jobs = new Map<number, Job>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private capture: (tabId: number) => Promise<CaptureResult>;
  constructor(capture: (tabId: number) => Promise<CaptureResult>) { this.capture = capture; }

  schedule(tabId: number, delay = 450) {
    if (tabId < 0) return;
    const pending = this.jobs.get(tabId);
    // Continuous page activity must not postpone a capture forever.
    this.jobs.set(tabId, { tabId, due: pending ? Math.min(pending.due, Date.now() + delay) : Date.now() + delay, attempt: 0 });
    this.arm();
  }

  cancel(tabId: number) { this.jobs.delete(tabId); this.arm(); }

  private arm() {
    clearTimeout(this.timer);
    if (this.running || !this.jobs.size) return;
    const due = Math.min(...Array.from(this.jobs.values(), job => job.due));
    this.timer = setTimeout(() => { void this.run(); }, Math.max(0, due - Date.now()));
  }

  private async run() {
    if (this.running) return;
    const next = [...this.jobs.values()].sort((a, b) => a.due - b.due)[0];
    if (!next) return;
    this.jobs.delete(next.tabId);
    this.running = true;
    try {
      const result = await this.capture(next.tabId);
      if (result === 'retry' && next.attempt < 2 && !this.jobs.has(next.tabId)) {
        this.jobs.set(next.tabId, { ...next, attempt: next.attempt + 1, due: Date.now() + 1200 * (next.attempt + 1) });
      }
    } catch { /* Later browsing events or the recovery alarm can try again. */ }
    finally { this.running = false; this.arm(); }
  }
}
