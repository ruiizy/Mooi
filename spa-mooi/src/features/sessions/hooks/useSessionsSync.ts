import { useCallback, useEffect, useState } from 'react';
import { env } from '@/config/env';
import { fetchSessions } from '@/features/sessions/api/sessionsApi';
import { useSessionsStore } from '@/stores/sessionsStore';

interface UseSessionsSync {
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Keeps the session list of one project — or of every project, without `projectId` — live on screens
 * that open no event stream. The server list replaces the store's sessions in that scope every
 * `sessionsRefreshMs` while the tab is visible, and right away when it becomes visible again;
 * `mergeSession` still keeps the fresher copy when an open stream got there first.
 */
export const useSessionsSync = (projectId: string | undefined, enabled = true): UseSessionsSync => {
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let inFlight = false;
    let timer: number | undefined;

    const schedule = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = window.setTimeout(() => void load(), env.sessionsRefreshMs);
    };

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const knownIds = new Set(useSessionsStore.getState().sessions.map((session) => session.id));
      try {
        const sessions = await fetchSessions(projectId);
        if (cancelled) return;
        useSessionsStore.getState().syncSessions(sessions, projectId, knownIds);
        setError(null);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load the sessions.');
      } finally {
        inFlight = false;
        if (!cancelled) {
          setLoading(false);
          schedule();
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
      else window.clearTimeout(timer);
    };

    setLoading(true);
    void load();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [projectId, enabled, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  return { loading, error, reload };
};
