import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { captureTarget } from '@/features/dictation/lib/captureTarget';
import { DictationSession } from '@/features/dictation/lib/DictationSession';
import { DICTATION_MESSAGES } from '@/features/dictation/lib/dictationMessages';
import { LiveTranscript } from '@/features/dictation/lib/LiveTranscript';
import type { DictationController } from '@/features/dictation/types/DictationController';
import type { DictationField } from '@/features/dictation/types/DictationField';
import type { DictationState } from '@/features/dictation/types/DictationState';

/** An error stays on the button long enough to be read, then the microphone returns to rest. */
const ERROR_VISIBLE_MS = 6000;

/**
 * The dictation state machine (`idle → connecting → recording → stopping → idle`) bound to one
 * field: the running transcript is written straight into it, at the cursor. The state is mirrored
 * in a ref so window-level listeners always read the current value, and every session callback is
 * ignored once its session is no longer the current one.
 */
export const useDictation = (field: RefObject<DictationField | null>): DictationController => {
  const [state, setStateValue] = useState<DictationState>('idle');
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<DictationState>('idle');
  const session = useRef<DictationSession | null>(null);
  const transcript = useRef<LiveTranscript | null>(null);

  const setState = useCallback((next: DictationState) => {
    stateRef.current = next;
    setStateValue(next);
  }, []);

  const end = useCallback(() => {
    session.current = null;
    transcript.current = null;
    setState('idle');
  }, [setState]);

  const start = useCallback(() => {
    if (session.current) return;
    const target = captureTarget(field.current);
    if (!target) {
      setError(DICTATION_MESSAGES.noTarget);
      return;
    }
    // Focus after the snapshot: the caret shows where the words land without moving it.
    target.element.focus({ preventScroll: true });
    setError(null);
    setState('connecting');

    const live = new LiveTranscript(target);
    const current: DictationSession = new DictationSession({
      onReady: () => {
        if (session.current === current) setState('recording');
      },
      onPartial: (partial) => {
        if (session.current === current) live.update(partial);
      },
      onStopping: () => {
        if (session.current === current) setState('stopping');
      },
      onFinal: (final) => {
        if (session.current !== current) return;
        if (!final) {
          live.rollback();
          setError(DICTATION_MESSAGES.emptyResult);
        } else if (!live.update(final)) {
          live.rollback();
          setError(DICTATION_MESSAGES.fieldChanged);
        }
        end();
      },
      onError: (message) => {
        if (session.current !== current) return;
        live.rollback();
        setError(message);
        end();
      },
    });
    session.current = current;
    transcript.current = live;
    void current.start();
  }, [end, field, setState]);

  const finish = useCallback(() => {
    session.current?.dispose();
    end();
    setError(null);
  }, [end]);

  const stop = useCallback(() => {
    // Connecting has no audio to finalize; do not wait for permission or the server.
    if (stateRef.current === 'connecting') finish();
    else session.current?.stop();
  }, [finish]);

  const resumeAudio = useCallback(() => session.current?.resumeAudio(), []);

  const cancel = useCallback(() => {
    session.current?.dispose();
    transcript.current?.rollback();
    end();
    setError(null);
  }, [end]);

  const isActive = useCallback(() => session.current !== null || stateRef.current !== 'idle', []);

  // A backgrounded app loses the microphone (iOS ends it outright): keep what was said, drop the rest.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'hidden' || !session.current) return;
      if (stateRef.current === 'recording') stop();
      else cancel();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [cancel, stop]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), ERROR_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => () => {
    session.current?.dispose();
    transcript.current?.rollback();
  }, []);

  return { state, error, isActive, start, stop, cancel, finish, resumeAudio };
};
