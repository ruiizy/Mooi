import { useCallback, useMemo, useState } from 'react';
import type { PlatformChatRequest } from '@/features/platform/types/PlatformChatRequest';
import { createSession } from '@/features/sessions/api/sessionsApi';
import type { Session } from '@/features/sessions/types/Session';
import type { SessionKind } from '@/features/sessions/types/SessionKind';
import { useSessionsStore } from '@/stores/sessionsStore';

interface UsePlatformChat {
  chat: Session | undefined;
  starting: boolean;
  error: string | null;
  start: (request: PlatformChatRequest) => Promise<Session | null>;
  clearError: () => void;
}

/**
 * The project's live platform chat of one kind, if any. Starting a new one replaces the previous chat
 * of that kind on the server; the first message is delivered as soon as the agent is ready.
 */
export const usePlatformChat = (projectId: string | undefined, kind: Exclude<SessionKind, 'session'>): UsePlatformChat => {
  const sessions = useSessionsStore((state) => state.sessions);
  const chat = useMemo(() => sessions.find((session) => session.projectId === projectId && session.kind === kind
    && session.status !== 'closed'), [sessions, projectId, kind]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (request: PlatformChatRequest): Promise<Session | null> => {
    if (!projectId) return null;
    setStarting(true);
    setError(null);
    try {
      const session = await createSession({ projectId, kind, provider: request.provider,
        adapter: request.adapter, connectionId: request.connectionId, model: request.model, effort: request.effort, initialMessage: request.message });
      const store = useSessionsStore.getState();
      store.sessions.filter((item) => item.projectId === projectId && item.kind === kind && item.id !== session.id)
        .forEach((item) => store.removeSession(item.id));
      store.upsertSession(session);
      return session;
    } catch (failure) {
      setError((failure as Error).message);
      return null;
    } finally {
      setStarting(false);
    }
  }, [projectId, kind]);

  const clearError = useCallback(() => setError(null), []);

  return { chat, starting, error, start, clearError };
};
