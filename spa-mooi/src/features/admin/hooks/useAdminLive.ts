import { useEffect, useReducer, useState } from 'react';
import type { AdminSession } from '@/features/admin/types/AdminSession';
import { openEventStream, type EventStreamState, type StreamFrame } from '@/features/sessions/lib/openEventStream';

export interface AdminLiveState {
  /** Connected devices per user id; a user missing here is offline. */
  presence: Record<string, number>;
  /** When a user went offline while this view watched: fresher than the directory's last seen. */
  offlineAt: Record<string, string>;
  sessions: Record<string, AdminSession>;
}

const EMPTY: AdminLiveState = { presence: {}, offlineAt: {}, sessions: {} };

const reduce = (state: AdminLiveState, frame: StreamFrame): AdminLiveState => {
  switch (frame.type) {
    case 'sync': {
      const data = frame.data as { presence: Record<string, number>; sessions: AdminSession[] };
      return {
        presence: data.presence,
        offlineAt: state.offlineAt,
        sessions: Object.fromEntries(data.sessions.map((session) => [session.id, session])),
      };
    }
    case 'admin.presence': {
      const { playerId, connections } = frame.data as { playerId: string; connections: number };
      const { [playerId]: _gone, ...others } = state.presence;
      if (connections > 0) return { ...state, presence: { ...others, [playerId]: connections } };
      return { ...state, presence: others, offlineAt: { ...state.offlineAt, [playerId]: frame.at } };
    }
    case 'admin.session': {
      const session = frame.data as unknown as AdminSession;
      return { ...state, sessions: { ...state.sessions, [session.id]: session } };
    }
    case 'admin.session.removed': {
      const { sessionId } = frame.data as { sessionId: string };
      if (!(sessionId in state.sessions)) return state;
      const { [sessionId]: _removed, ...sessions } = state.sessions;
      return { ...state, sessions };
    }
    default:
      return state;
  }
};

/**
 * The administrators' live channel: who is connected and every live chat, kept current by
 * mic-sessions for as long as this view is open. Each (re)connection starts from a `sync` snapshot.
 */
export const useAdminLive = () => {
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const [streamState, setStreamState] = useState<EventStreamState>('reconnecting');

  useEffect(() => openEventStream({ path: '/admin/events', after: 0, onFrame: dispatch, onState: setStreamState }), []);

  return { ...state, streamState };
};
