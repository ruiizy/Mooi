import type { SessionConfiguration } from '@/features/sessions/types/SessionConfiguration';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answerPermission,
  answerQuestion,
  clearSessionConversation,
  compactSession,
  fetchChanges,
  fetchSession,
  fetchSessionProvider,
  interruptSession,
  recoverSession,
  sendSessionMessage,
  updateSessionConfiguration,
} from '@/features/sessions/api/sessionsApi';
import { seedSessionImage } from '@/features/sessions/lib/sessionImageCache';
import type { PreparedImage } from '@/features/sessions/types/PreparedImage';
import type { Session } from '@/features/sessions/types/Session';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';
import { useSessionsStore } from '@/stores/sessionsStore';

interface UseSession {
  session: Session | undefined;
  loading: boolean;
  error: string | null;
  busy: boolean;
  actionError: string | null;
  send: (text: string, images?: PreparedImage[]) => Promise<boolean>;
  interrupt: () => Promise<boolean>;
  recover: () => Promise<boolean>;
  compact: (instructions?: string) => Promise<boolean>;
  clearConversation: () => Promise<boolean>;
  allowPermission: (requestId: string, updatedInput?: Record<string, unknown>) => Promise<boolean>;
  denyPermission: (requestId: string, message?: string) => Promise<boolean>;
  answer: (requestId: string, answers: Record<string, string | string[]>, response?: string) => Promise<boolean>;
  modelOptions: SessionProvider['models'];
  modelLoading: boolean;
  modelError: string | null;
  updateConfiguration: (configuration: SessionConfiguration) => Promise<boolean>;
  clearActionError: () => void;
}

/**
 * One session plus its turn actions. Turn actions rely on the
 * SSE stream (`useSessionStream`, mounted alongside this hook) delivers the very events they cause
 * — `message.user`, `permission.resolved`, ... — so folding happens exactly once, in one place
 * Configuration also merges the PATCH response; the store rejects stale sequence numbers.
 * `busy`/`actionError` here are purely about the request itself.
 *
 * Seeds the changes panel with a direct `fetchChanges` on mount rather than waiting for a replayed
 * `changes.updated` to survive inside the server's bounded event log, so a reopened session or a
 * second browser tab shows the right diff immediately; the stream keeps it fresh from there on.
 */
export const useSession = (sessionId: string | undefined): UseSession => {
  const session = useSessionsStore((state) => state.sessions.find((candidate) => candidate.id === sessionId));
  const streamState = useSessionsStore((state) => sessionId ? state.byId[sessionId]?.streamState : undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<SessionProvider['models']>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const actionPending = useRef(false);
  const previousStatus = useRef<string | undefined>(undefined);
  const previousStreamState = useRef<string | undefined>(undefined);

  const refreshChanges = useCallback(async () => {
    if (!sessionId) return;
    const requestSeq = useSessionsStore.getState().byId[sessionId]?.lastSeq ?? 0;
    useSessionsStore.getState().setChangesLoading(sessionId);

    try {
      const changes = await fetchChanges(sessionId);
      useSessionsStore.getState().setChanges(sessionId, changes, requestSeq);
    } catch (failure) {
      useSessionsStore.getState().setChangesError(sessionId, (failure as Error).message, requestSeq);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    useSessionsStore.getState().ensureTranscript(sessionId);
    void fetchSession(sessionId)
      .then((loadedSession) => {
        if (!cancelled) useSessionsStore.getState().upsertSession(loadedSession);
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    void refreshChanges();

    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshChanges]);

  useEffect(() => {
    if (!sessionId || !session) return;
    if (previousStatus.current === 'provisioning' && session.status === 'ready') {
      void refreshChanges();
    }
    previousStatus.current = session.status;
  }, [refreshChanges, session, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (previousStreamState.current === 'reconnecting' && streamState === 'open') {
      void refreshChanges();
    }
    previousStreamState.current = streamState;
  }, [refreshChanges, sessionId, streamState]);

  useEffect(() => {
    if (!session?.provider || !session.connectionId) return;

    let cancelled = false;
    setModelOptions([]);
    setModelLoading(true);
    setModelError(null);
    fetchSessionProvider(session.provider, session.connectionId, false, session.adapter)
      .then((provider) => {
        if (!cancelled) {
          setModelOptions(provider.models ?? []);
          setModelError(provider.unavailable ?? null);
        }
      })
      .catch((failure: Error) => {
        if (!cancelled) setModelError(failure.message);
      })
      .finally(() => {
        if (!cancelled) setModelLoading(false);
      });

    return () => { cancelled = true; };
  }, [session?.provider, session?.connectionId, session?.adapter]);

  const runAction = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(true);
    setActionError(null);

    try {
      await action();
      return true;
    } catch (failure) {
      setActionError((failure as Error).message);
      return false;
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }, []);

  const send = useCallback(
    (text: string, images: PreparedImage[] = []) => {
      const current = useSessionsStore.getState().sessions.find((candidate) => candidate.id === sessionId);
      if (!sessionId || current?.status !== 'ready' || current.deployment.state === 'starting') return Promise.resolve(false);
      return runAction(async () => {
        const sent = await sendSessionMessage(sessionId, text, images.map((image) => image.upload));
        // The transcript shows the sender's images from their local copies, never a download.
        sent.images?.forEach((stored, index) => {
          if (images[index]) seedSessionImage(sessionId, stored.id, images[index].blob);
        });
      });
    },
    [sessionId, runAction],
  );

  const interrupt = useCallback(
    () => (sessionId ? runAction(() => interruptSession(sessionId)) : Promise.resolve(false)),
    [sessionId, runAction],
  );

  const recover = useCallback(
    () => (sessionId && useSessionsStore.getState().sessions.some((item) => item.id === sessionId && item.status === 'failed')
      ? runAction(() => recoverSession(sessionId)) : Promise.resolve(false)),
    [sessionId, runAction],
  );

  const compact = useCallback(
    (instructions?: string) => (sessionId && useSessionsStore.getState().sessions.some((item) => item.id === sessionId && item.status === 'ready')
      ? runAction(() => compactSession(sessionId, instructions)) : Promise.resolve(false)),
    [sessionId, runAction],
  );

  const clearConversation = useCallback(
    () => (sessionId && useSessionsStore.getState().sessions.some((item) => item.id === sessionId && item.status === 'ready')
      ? runAction(() => clearSessionConversation(sessionId)) : Promise.resolve(false)),
    [sessionId, runAction],
  );

  const allowPermission = useCallback(
    (requestId: string, updatedInput?: Record<string, unknown>) =>
      sessionId
        ? runAction(() => answerPermission(sessionId, requestId, 'allow', undefined, updatedInput))
        : Promise.resolve(false),
    [sessionId, runAction],
  );

  const denyPermission = useCallback(
    (requestId: string, message?: string) =>
      sessionId ? runAction(() => answerPermission(sessionId, requestId, 'deny', message)) : Promise.resolve(false),
    [sessionId, runAction],
  );

  const answer = useCallback(
    (requestId: string, answers: Record<string, string | string[]>, response?: string) =>
      sessionId ? runAction(() => answerQuestion(sessionId, requestId, answers, response)) : Promise.resolve(false),
    [sessionId, runAction],
  );

  const updateConfiguration = useCallback(
    (configuration: SessionConfiguration) => {
      const current = useSessionsStore.getState().sessions.find((candidate) => candidate.id === sessionId);
      if (!sessionId || !current || loading || modelLoading || modelError || current.status === 'closed' || current.status === 'failed' || current.status === 'compacting' || current.deployment.state === 'starting') return Promise.resolve(false);
      return runAction(async () => {
        const updated = await updateSessionConfiguration(sessionId, configuration);
        useSessionsStore.getState().upsertSession(updated);
      });
    },
    [sessionId, runAction, loading, modelLoading, modelError],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    session,
    loading,
    error,
    busy,
    actionError,
    send,
    interrupt,
    recover,
    compact,
    clearConversation,
    allowPermission,
    denyPermission,
    answer,
    modelOptions,
    modelLoading,
    modelError,
    updateConfiguration,
    clearActionError,
  };
};
