import { acquireDictationAudio, discardDictationAudio, releaseDictationAudio } from '@/features/dictation/lib/dictationAudio';

const MICROPHONE: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
};
/** iOS keeps `resume()` pending forever while its audio session is interrupted: never wait longer. */
const AUDIO_START_TIMEOUT_MS = 5_000;
/** iOS can interrupt the worklet when capture stops: finalization never waits longer for the tail. */
const FLUSH_TIMEOUT_MS = 250;

export interface DictationCaptureEvents {
  /** One PCM16 16 kHz mono frame, in capture order. */
  onFrame: (frame: ArrayBuffer) => void;
  /** The microphone or the audio engine went away (unplugged, interrupted for good). */
  onLost: () => void;
}

/**
 * One microphone capture: stream → shared audio engine → worklet → PCM16 frames. The microphone
 * always opens before the engine runs: opening it changes the audio route (iOS audio session,
 * echo-cancelled input on desktop), and an engine already rendering across that change can stay
 * silent or stalled. Every capture of a page thus follows the path of its first one. `release`
 * frees everything and is idempotent; once released no event fires again.
 */
export class DictationCapture {
  private readonly events: DictationCaptureEvents;
  private released = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private flushed: (() => void) | null = null;

  constructor(events: DictationCaptureEvents) {
    this.events = events;
  }

  /** Requests the microphone; rejects with the `getUserMedia` error. */
  async openMicrophone(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia(MICROPHONE);
    if (this.released) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
      if (this.stream === stream) this.events.onLost();
    }));
  }

  /** Runs the engine and connects the microphone to the worklet; rejects when audio cannot start. */
  async startAudio(): Promise<void> {
    if (this.released || !this.stream) return;
    const context = await acquireDictationAudio();
    if (this.released) {
      releaseDictationAudio(context);
      return;
    }
    this.context = context;
    await resumeBounded(context);
    if (this.released) return;
    this.source = context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(context, 'dictation', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    this.node.port.onmessage = ({ data }) => this.receive(data);
    // The worklet outputs silence; reaching the destination only keeps it processing.
    this.source.connect(this.node).connect(context.destination);
    context.addEventListener('statechange', this.onStateChange);
  }

  /** Resumes the engine from a user activation, once this capture owns it (never before the microphone). */
  resume(): void {
    if (!this.released && this.context) void this.context.resume().catch(() => undefined);
  }

  /** Releases the microphone at once; resolves once the worklet delivered its buffered tail. */
  stop(): Promise<void> {
    this.stopTracks();
    if (this.released || !this.node) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => this.flush(), FLUSH_TIMEOUT_MS);
      this.flushed = () => {
        window.clearTimeout(timer);
        resolve();
      };
      this.node?.port.postMessage('stop');
    });
  }

  /** `discard` closes the engine so the next capture builds a fresh one. */
  release(discard = false): void {
    if (this.released) return;
    this.released = true;
    this.stopTracks();
    this.source?.disconnect();
    if (this.node) {
      // Ends the processor; a closed port alone leaves it running in the shared engine.
      this.node.port.postMessage('close');
      this.node.port.onmessage = null;
      this.node.port.close();
      this.node.disconnect();
    }
    if (this.context) {
      this.context.removeEventListener('statechange', this.onStateChange);
      if (discard) discardDictationAudio(this.context);
      else releaseDictationAudio(this.context);
    }
    this.flush();
    this.source = null;
    this.node = null;
    this.context = null;
  }

  private receive(data: unknown): void {
    if (this.released) return;
    if (data === 'stopped') this.flush();
    else if (data instanceof ArrayBuffer) this.events.onFrame(data);
  }

  private flush(): void {
    const flushed = this.flushed;
    this.flushed = null;
    flushed?.();
  }

  /** A phone call, Siri or another app takes the audio away (`interrupted` on iOS): resume or give up. */
  private readonly onStateChange = (): void => {
    const context = this.context;
    if (this.released || !context || context.state === 'running') return;
    if (context.state === 'closed') {
      this.events.onLost();
      return;
    }
    void resumeBounded(context).catch(() => {
      if (!this.released) this.events.onLost();
    });
  };

  private stopTracks(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

const resumeBounded = async (context: AudioContext): Promise<void> => {
  if (context.state === 'running') return;
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('audio start timeout')), AUDIO_START_TIMEOUT_MS);
  });
  try {
    await Promise.race([context.resume(), timeout]);
  } finally {
    window.clearTimeout(timer);
  }
  if ((context.state as string) !== 'running') throw new Error('audio not running');
};
