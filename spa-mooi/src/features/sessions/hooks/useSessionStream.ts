import { useEffect } from 'react';
import { openSessionStream } from '@/features/sessions/lib/openSessionStream';
import { useSessionsStore } from '@/stores/sessionsStore';

/**
 * Opens the live tail of one session's event log for as long as the caller stays mounted, folding
 * every event into the store via `applyEvent`. Reads `after` from the transcript's own
 * `lastSeq` at open time: 0 for a bucket just created by `ensureTranscript` (first open, full
 * replay), or wherever it already is if this hook remounts while the bucket survives.
 */
export const useSessionStream = (sessionId: string | undefined): void => {
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    useSessionsStore.getState().ensureTranscript(sessionId);
    const after = useSessionsStore.getState().byId[sessionId]?.lastSeq ?? 0;

    const close = openSessionStream({
      sessionId,
      after,
      onEvent: (event) => useSessionsStore.getState().applyEvent(sessionId, event),
      onState: (state) => useSessionsStore.getState().setStreamState(sessionId, state),
    });

    return () => {
      close();
      // A session closed while it was watched stays on screen only as long as someone looks at it.
      const store = useSessionsStore.getState();
      if (store.sessions.find((session) => session.id === sessionId)?.status === 'closed') store.removeSession(sessionId);
    };
  }, [sessionId]);
};
