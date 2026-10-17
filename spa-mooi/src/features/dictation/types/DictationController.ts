import type { DictationState } from '@/features/dictation/types/DictationState';

export interface DictationController {
  state: DictationState;
  error: string | null;
  /** True while a session exists, read synchronously by global key and pointer listeners. */
  isActive: () => boolean;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  /** Releases the microphone immediately, keeping the text already written in the field. */
  finish: () => void;
  /** Lets the audio engine run; called from a real user activation (touch `pointerdown` is not one). */
  resumeAudio: () => void;
}
