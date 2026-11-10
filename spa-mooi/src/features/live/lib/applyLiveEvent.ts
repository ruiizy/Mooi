import type { StreamFrame } from '@/features/sessions/lib/openEventStream';
import type { Session } from '@/features/sessions/types/Session';
import { useLiveStore } from '@/stores/liveStore';
import { useSessionsStore } from '@/stores/sessionsStore';

/** Routes one frame of the player's channel: session summaries to the sessions store, the rest to the live store. */
export const applyLiveEvent = (frame: StreamFrame): void => {
  const sessions = useSessionsStore.getState();
  switch (frame.type) {
    case 'sync':
      sessions.syncSessions(frame.data.sessions as Session[]);
      break;
    case 'session.updated':
      sessions.upsertSession(frame.data as unknown as Session);
      return;
    case 'session.removed':
      sessions.retireSession(String(frame.data.sessionId));
      return;
    default:
      break;
  }
  useLiveStore.getState().apply(frame);
};
