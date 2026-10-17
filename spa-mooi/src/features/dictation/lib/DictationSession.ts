import { DictationAudioHealth } from '@/features/dictation/lib/DictationAudioHealth';
import { DICTATION_MESSAGES } from '@/features/dictation/lib/dictationMessages';
import { dictationStreamUrl } from '@/features/dictation/lib/dictationStreamUrl';
import type { DictationCallbacks } from '@/features/dictation/types/DictationCallbacks';
import type { DictationServerMessage } from '@/features/dictation/types/DictationServerMessage';
import { microphoneErrorMessage } from '@/features/dictation/lib/microphoneErrorMessage';
import { acquireAudioSession } from '@/features/dictation/lib/audioSession';
import { acquireDictationAudio, discardDictationAudio, releaseDictationAudio, restartDictationAudio, resumeDictationAudio } from '@/features/dictation/lib/dictationAudio';

const CONNECT_TIMEOUT_MS = 15_000;
const FINALIZE_TIMEOUT_MS = 30_000;
/** iOS keeps `resume()` pending forever while its audio session is interrupted: never wait longer. */
const AUDIO_START_TIMEOUT_MS = 5_000;
/** ~4 s of PCM16 at 16 kHz queued unsent: the link cannot keep up with real time. */
const MAX_BUFFERED_BYTES = 128_000;

/**
 * One dictation: microphone → AudioWorklet (native rate in, PCM16 16 kHz 500 ms frames out) → WebSocket to
 * mic-speech, and the running transcript back. The microphone is requested first, inside the user
 * gesture, before any server session exists. Every exit path releases every resource, and once
 * disposed no callback fires again. Audio start is bounded in time, so a browser that never lets
 * the audio run (iOS audio interruption, missing user activation) ends in an error, never a hang.
 * The engine is shared across chats. Missing audio gets one bounded recovery attempt;
 * an empty transcript alone never discards a healthy engine.
 */
export class DictationSession {
  private readonly callbacks: DictationCallbacks;
  private closed = false;
  private stopping = false;
  private ready = false;
  private audioFailed = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private socket: WebSocket | null = null;
  private timer: number | undefined;
  private flushTimer: number | undefined;
  private recoveryTimer: number | undefined;
  private recovering = false;
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
    resumeDictationAudio();
    this.arm(CONNECT_TIMEOUT_MS, DICTATION_MESSAGES.audioBlocked);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (this.closed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
    } catch (error) {
      this.fail(microphoneErrorMessage(error));
      return;
    }
    this.watchTracks(this.stream);

    let context: AudioContext;
    try {
      context = await acquireDictationAudio();
    } catch {
      this.fail(DICTATION_MESSAGES.audioBlocked);
      return;
    }
    if (this.closed) {
      releaseDictationAudio(context);
      return;
    }
    this.context = context;
    try {
      await this.startAudio(context);
      if (this.closed) return;
    } catch {
      this.failAudio(DICTATION_MESSAGES.audioBlocked);
      return;
    }
    this.context.addEventListener('statechange', this.onAudioStateChange);

    this.open();
  }

  /**
   * Resumes the audio engine; call it from a user activation (`pointerup`, `click`, `keydown`).
   * Touch `pointerdown` is not an activation, so the engine may still be waiting for one.
   */
  resumeAudio(): void {
    if (this.closed || this.stopping) return;
    if (this.context) void this.context.resume().catch(() => undefined);
    else resumeDictationAudio();
  }

  /** Releases capture synchronously; the worklet then flushes audio already buffered. */
  stop(): void {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    this.health.stop();
    window.clearTimeout(this.recoveryTimer);
    this.stopTracks();
    if (!this.ready) {
      this.dispose();
      this.callbacks.onFinal('');
      return;
    }
    this.callbacks.onStopping();
    this.arm(FINALIZE_TIMEOUT_MS, DICTATION_MESSAGES.finalizeTimeout);
    this.node?.port.postMessage('stop');
    // iOS can interrupt the worklet when capture stops: finalization must still proceed.
    this.flushTimer = window.setTimeout(() => this.finishCapture(), 250);
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.timer);
    this.stopTracks();
    window.clearTimeout(this.flushTimer);
    window.clearTimeout(this.recoveryTimer);
    this.health.stop();
    this.releaseCapture();
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }

  private async startAudio(context: AudioContext, restart = false): Promise<void> {
    if (!restart && context.state === 'running') return;
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('audio start timeout')), AUDIO_START_TIMEOUT_MS);
    });
    try {
      await Promise.race([restart ? restartDictationAudio(context, () => !this.closed && !this.stopping) : context.resume(), timeout]);
    } finally {
      window.clearTimeout(timer);
    }
    if ((context.state as string) !== 'running') throw new Error('audio not running');
  }

  /** A phone call, Siri or another app takes the audio away (`interrupted` on iOS): recover or end. */
  private readonly onAudioStateChange = (): void => {
    const context = this.context;
    if (this.closed || this.stopping || this.recovering || !context || context.state === 'running') return;
    if (context.state === 'closed') {
      this.failAudio(DICTATION_MESSAGES.microphoneDisconnected);
      return;
    }
    void this.startAudio(context).catch(() => this.failAudio(DICTATION_MESSAGES.microphoneDisconnected));
  };

  private open(): void {
    const socket = new WebSocket(dictationStreamUrl());
    this.socket = socket;
    this.arm(CONNECT_TIMEOUT_MS, DICTATION_MESSAGES.connectTimeout);
    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => this.fail(this.ready ? DICTATION_MESSAGES.connectionInterrupted : DICTATION_MESSAGES.connectFailed);
    socket.onclose = () => this.fail(this.ready ? DICTATION_MESSAGES.connectionInterrupted : DICTATION_MESSAGES.connectFailed);
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
        this.onReady(message.maxSeconds);
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

  private onReady(maxSeconds: number): void {
    const { context, stream } = this;
    if (!context || !stream) return;
    window.clearTimeout(this.timer);
    try {
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, 'dictation', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.node.port.onmessage = ({ data }) => this.onFrame(data);
      // The worklet outputs silence; reaching the destination only keeps it processing.
      this.source.connect(this.node).connect(context.destination);
    } catch {
      this.failAudio(DICTATION_MESSAGES.microphoneUnavailable);
      return;
    }
    this.ready = true;
    this.callbacks.onReady();
    this.health.start();
    this.timer = window.setTimeout(() => this.stop(), maxSeconds * 1000);
  }

  private onFrame(data: unknown): void {
    const socket = this.socket;
    if (this.closed || !socket) return;
    if (data === 'stopped') {
      this.finishCapture();
      return;
    }
    if (!(data instanceof ArrayBuffer) || socket.readyState !== WebSocket.OPEN) return;
    if (!this.stopping) this.health.frame(data);
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.fail(DICTATION_MESSAGES.backpressure);
      return;
    }
    socket.send(data);
  }

  private watchTracks(stream: MediaStream): void {
    stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
      if (this.stream === stream && !this.stopping) this.fail(DICTATION_MESSAGES.microphoneDisconnected);
    }));
  }

  private async recoverCapture(): Promise<void> {
    const context = this.context;
    if (this.closed || this.stopping || !context) return;
    this.recovering = true;
    this.recoveryTimer = window.setTimeout(() => this.failAudio(DICTATION_MESSAGES.audioNoSignal), AUDIO_START_TIMEOUT_MS);
    try {
      this.source?.disconnect();
      this.stopTracks();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (this.closed || this.stopping) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.watchTracks(stream);
      await this.startAudio(context, true);
      if (this.closed || this.stopping || !this.node) return;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.node);
    } finally {
      window.clearTimeout(this.recoveryTimer);
      this.recovering = false;
    }
  }

  private finishCapture(): void {
    if (this.closed || !this.context) return;
    window.clearTimeout(this.flushTimer);
    this.releaseCapture();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'stop' }));
  }

  private releaseCapture(): void {
    this.source?.disconnect();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.close();
      this.node.disconnect();
    }
    if (this.context) {
      this.context.removeEventListener('statechange', this.onAudioStateChange);
      if (this.audioFailed) discardDictationAudio(this.context);
      else releaseDictationAudio(this.context);
    }
    this.source = null;
    this.node = null;
    this.context = null;
    this.releaseAudioSession?.();
    this.releaseAudioSession = null;
  }

  private arm(delay: number, message: string): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.fail(message), delay);
  }

  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
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
