import { DictationAudioHealth } from '@/features/dictation/lib/DictationAudioHealth';
import { DictationCapture } from '@/features/dictation/lib/DictationCapture';
import { DICTATION_MESSAGES } from '@/features/dictation/lib/dictationMessages';
import { dictationStreamUrl } from '@/features/dictation/lib/dictationStreamUrl';
import type { DictationCallbacks } from '@/features/dictation/types/DictationCallbacks';
import type { DictationServerMessage } from '@/features/dictation/types/DictationServerMessage';
import { microphoneErrorMessage } from '@/features/dictation/lib/microphoneErrorMessage';
import { acquireAudioSession } from '@/features/dictation/lib/audioSession';

const CONNECT_TIMEOUT_MS = 15_000;
const FINALIZE_TIMEOUT_MS = 30_000;
/** ~4 s of PCM16 at 16 kHz queued unsent: the link cannot keep up with real time. */
const MAX_BUFFERED_BYTES = 128_000;
const BYTES_PER_MS = 32;

/**
 * One dictation: microphone → AudioWorklet (native rate in, PCM16 16 kHz 100 ms frames out) → WebSocket to
 * mic-speech, and the running transcript back. The microphone is requested first, inside the user
 * gesture, before any server session exists; the audio engine starts only once it is open. Capture
 * and connection then start together: frames captured before the server is ready are queued, so
 * no spoken word is lost. Recording is announced only when the server is ready *and* the microphone
 * is heard; a capture without signal is rebuilt once (fresh microphone and audio engine), then
 * fails. Every exit path releases every resource, and once disposed no callback fires again.
 */
export class DictationSession {
  private readonly callbacks: DictationCallbacks;
  private closed = false;
  private stopping = false;
  private serverReady = false;
  private heard = false;
  private ready = false;
  private audioFailed = false;
  private maxSeconds = 0;
  private capturedBytes = 0;
  private pending: ArrayBuffer[] = [];
  private capture: DictationCapture | null = null;
  private socket: WebSocket | null = null;
  private timer: number | undefined;
  private limitTimer: number | undefined;
  private releaseAudioSession: (() => void) | null = null;
  private readonly health = new DictationAudioHealth(
    () => this.recoverCapture(),
    () => this.failAudio(DICTATION_MESSAGES.audioNoSignal),
  );

  constructor(callbacks: DictationCallbacks) {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fail(DICTATION_MESSAGES.insecureContext);
      return;
    }
    this.releaseAudioSession = acquireAudioSession();
    this.arm(CONNECT_TIMEOUT_MS, DICTATION_MESSAGES.audioBlocked);
    const capture = this.createCapture();
    try {
      await capture.openMicrophone();
    } catch (error) {
      this.fail(microphoneErrorMessage(error));
      return;
    }
    if (this.closed) return;
    this.open();
    try {
      await capture.startAudio();
    } catch {
      this.failAudio(DICTATION_MESSAGES.audioBlocked);
      return;
    }
    if (!this.closed) this.health.start();
  }

  /**
   * Resumes the audio engine; call it from a user activation (`pointerup`, `click`, `keydown`).
   * Touch `pointerdown` is not an activation, so the engine may still be waiting for one. Before
   * the microphone is open there is nothing to resume: the engine never runs ahead of it.
   */
  resumeAudio(): void {
    if (!this.closed && !this.stopping) this.capture?.resume();
  }

  /** Releases capture synchronously; the worklet then flushes audio already buffered. */
  stop(): void {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    this.health.stop();
    if (!this.ready) {
      this.dispose();
      this.callbacks.onFinal('');
      return;
    }
    this.callbacks.onStopping();
    this.arm(FINALIZE_TIMEOUT_MS, DICTATION_MESSAGES.finalizeTimeout);
    const capture = this.capture;
    void capture?.stop().then(() => this.finishCapture(capture));
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.limitTimer);
    this.health.stop();
    this.capture?.release(this.audioFailed);
    this.capture = null;
    this.pending = [];
    this.releaseAudioSession?.();
    this.releaseAudioSession = null;
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }

  private createCapture(): DictationCapture {
    const capture: DictationCapture = new DictationCapture({
      onFrame: (frame) => {
        if (this.capture === capture) this.onFrame(frame);
      },
      onLost: () => {
        if (this.capture === capture && !this.stopping) this.failAudio(DICTATION_MESSAGES.microphoneDisconnected);
      },
    });
    this.capture = capture;
    return capture;
  }

  private open(): void {
    const socket = new WebSocket(dictationStreamUrl());
    this.socket = socket;
    this.arm(CONNECT_TIMEOUT_MS, DICTATION_MESSAGES.connectTimeout);
    socket.onmessage = (event) => this.receive(event.data);
    const lost = () => this.fail(this.serverReady ? DICTATION_MESSAGES.connectionInterrupted : DICTATION_MESSAGES.connectFailed);
    socket.onerror = lost;
    socket.onclose = lost;
  }

  private receive(data: unknown): void {
    if (this.closed) return;
    let message: DictationServerMessage;
    try {
      message = JSON.parse(String(data)) as DictationServerMessage;
    } catch {
      this.fail(DICTATION_MESSAGES.invalidResponse);
      return;
    }
    switch (message.type) {
      case 'ready':
        this.onServerReady(message.maxSeconds);
        return;
      case 'partial':
        this.callbacks.onPartial(message.text);
        return;
      case 'final':
        // No recognized speech does not imply a broken audio engine.
        this.dispose();
        this.callbacks.onFinal(message.text);
        return;
      case 'error':
        this.fail(message.message);
        return;
      default:
        this.fail(DICTATION_MESSAGES.invalidResponse);
    }
  }

  private onServerReady(maxSeconds: number): void {
    window.clearTimeout(this.timer);
    this.serverReady = true;
    this.maxSeconds = maxSeconds;
    const pending = this.pending;
    this.pending = [];
    pending.forEach((frame) => this.socket?.send(frame));
    this.announce();
  }

  private onFrame(frame: ArrayBuffer): void {
    if (this.closed) return;
    this.capturedBytes += frame.byteLength;
    if (!this.stopping && this.health.frame(frame) && !this.heard) {
      this.heard = true;
      this.announce();
    }
    if (!this.serverReady) {
      this.pending.push(frame);
      return;
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.fail(DICTATION_MESSAGES.backpressure);
      return;
    }
    socket.send(frame);
  }

  /** Recording starts when the server is ready and the microphone is heard, whichever comes last. */
  private announce(): void {
    if (this.ready || this.stopping || !this.serverReady || !this.heard) return;
    this.ready = true;
    this.callbacks.onReady();
    // The server counts every frame, those captured before recording was announced included.
    const remaining = this.maxSeconds * 1000 - this.capturedBytes / BYTES_PER_MS;
    this.limitTimer = window.setTimeout(() => this.stop(), Math.max(0, remaining));
  }

  /** The proven path of a page's first capture: a new microphone stream on a fresh audio engine. */
  private async recoverCapture(): Promise<void> {
    if (this.closed || this.stopping) return;
    this.capture?.release(true);
    const capture = this.createCapture();
    await capture.openMicrophone();
    await capture.startAudio();
  }

  private finishCapture(capture: DictationCapture | null): void {
    if (this.closed || this.capture !== capture) return;
    capture?.release();
    this.capture = null;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'stop' }));
  }

  private arm(delay: number, message: string): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.fail(message), delay);
  }

  private failAudio(message: string): void {
    this.audioFailed = true;
    this.fail(message);
  }

  private fail(message: string): void {
    if (this.closed) return;
    this.dispose();
    this.callbacks.onError(message);
  }
}
