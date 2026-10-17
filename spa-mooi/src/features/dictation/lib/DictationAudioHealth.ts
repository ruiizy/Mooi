/** Detects stalled or all-zero capture, independently of recognition results. */
const SIGNAL_TIMEOUT_MS = 3000;

export class DictationAudioHealth {
  private timer: number | undefined;
  private recovering = false;
  private recovered = false;

  private readonly recover: () => Promise<void>;
  private readonly fail: () => void;

  constructor(recover: () => Promise<void>, fail: () => void) {
    this.recover = recover;
    this.fail = fail;
  }

  start(): void {
    this.timer = window.setTimeout(() => void this.check(), SIGNAL_TIMEOUT_MS);
  }

  frame(data: ArrayBuffer): void {
    // Quiet speech and room noise have samples; exact digital zero means no input.
    if (!new Int16Array(data).some((sample) => sample !== 0) || this.recovering) return;
    this.stop();
    this.start();
  }

  stop(): void {
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async check(): Promise<void> {
    if (this.recovered) {
      this.fail();
      return;
    }
    this.recovered = true;
    this.recovering = true;
    try {
      await this.recover();
      if (this.timer !== undefined) this.start();
    } catch {
      if (this.timer !== undefined) this.fail();
    } finally {
      this.recovering = false;
    }
  }
}
