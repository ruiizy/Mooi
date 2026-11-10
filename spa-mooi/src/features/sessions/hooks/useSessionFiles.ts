import { useCallback, useEffect, useState } from 'react';
import { fetchSessionFiles } from '@/features/sessions/api/sessionsApi';
import type { SessionFiles } from '@/features/sessions/types/SessionFiles';
import { useSessionsStore } from '@/stores/sessionsStore';

/**
 * The session's file listing. It is read when the tab is shown and again whenever the live changes
 * summary moves, so files the agent creates or deletes appear without any manual refresh.
 */
export const useSessionFiles = (sessionId: string, active: boolean) => {
  const changes = useSessionsStore((state) => state.byId[sessionId]?.changes);
  const [files, setFiles] = useState<SessionFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchSessionFiles(sessionId)
      .then((next) => {
        if (cancelled) return;
        setFiles(next);
        setError(null);
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message);
      });
    return () => {
      cancelled = true;
    };
  }, [active, attempt, changes, sessionId]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { files, error, retry };
};
