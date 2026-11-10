/** A fresh capture must deliver signal this fast: recording is never shown over a dead microphone. */
const START_SIGNAL_MS = 1500;
/** Once heard, a capture silent this long has stalled. */
const RUNNING_SIGNAL_MS = 3000;

/**
 * Watches the capture for real signal, independently of recognition results. Quiet speech and room
 * noise have samples; exact digital zero means no input. A capture without signal (at start or
 * mid-dictation) gets one recovery, which is then held to the start deadline; a second miss fails.
 */
export class DictationAudioHealth {
  private timer: number | undefined;
  private active = false;
  private recovering = false;
  private recovered = false;

  private readonly recover: () => Promise<void>;
  private readonly fail: () => void;

  constructor(recover: () => Promise<void>, fail: () => void) {
    this.recover = recover;
    this.fail = fail;
  }

  /** A capture is connected: it must deliver signal before the start deadline. */
  start(): void {
    this.active = true;
    this.arm(START_SIGNAL_MS);
  }

  /** True when the frame carries signal; it then pushes the stall deadline back. */
  frame(data: ArrayBuffer): boolean {
    if (!this.active || this.recovering || !new Int16Array(data).some((sample) => sample !== 0)) return false;
    this.arm(RUNNING_SIGNAL_MS);
    return true;
  }

  stop(): void {
    this.active = false;
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(delay: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.check(), delay);
  }

  private async check(): Promise<void> {
    this.timer = undefined;
    if (this.recovered) {
      this.fail();
      return;
    }
    this.recovered = true;
    this.recovering = true;
    try {
      await this.recover();
      this.recovering = false;
      if (this.active) this.arm(START_SIGNAL_MS);
    } catch {
      this.recovering = false;
      if (this.active) this.fail();
    }
  }
}
