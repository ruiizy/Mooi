import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchTrace } from '@/features/traces/api/tracesApi';
import type { AgentTrace } from '@/features/traces/types/AgentTrace';
import type { SessionStatus } from '@/features/sessions/types/SessionStatus';
import { useSessionsStore } from '@/stores/sessionsStore';

/** Minimum gap between two trace requests while the agent streams events. */
const THROTTLE_MS = 1200;

const LIVE_STATUSES: ReadonlySet<SessionStatus> = new Set(['working', 'waiting', 'compacting']);

/**
 * The session's agent trace, kept live without a stream of its own (D5): it is read when the tab
 * becomes `active`, then again (throttled, sending the last `revision` so an unchanged trace costs a
 * body-less `204`) whenever the session's event sequence moves, plus once more when the agent goes
 * idle. Nothing is fetched while the tab is hidden. A failed refresh keeps the last trace on screen.
 */
export const useAgentTrace = (sessionId: string, active: boolean) => {
  const lastSeq = useSessionsStore((state) => state.byId[sessionId]?.lastSeq ?? 0);
  const status = useSessionsStore((state) => state.sessions.find((session) => session.id === sessionId)?.status);
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const revision = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const lastFetchAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef<() => void>(() => undefined);

  const schedule = useCallback(() => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    if (timer.current) return;
    const wait = Math.max(0, lastFetchAt.current + THROTTLE_MS - Date.now());
    timer.current = setTimeout(() => {
      timer.current = null;
      loadRef.current();
    }, wait);
  }, []);

  const load = useCallback(() => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    const current = generation.current;
    inFlight.current = true;
    lastFetchAt.current = Date.now();
    setLoading(true);
    fetchTrace(sessionId, revision.current)
      .then((next) => {
        if (current !== generation.current) return;
        if (next) {
          revision.current = next.revision;
          setTrace(next);
        }
        setError(null);
      })
      .catch((failure: Error) => {
        if (current === generation.current) setError(failure.message);
      })
      .finally(() => {
        if (current !== generation.current) return;
        inFlight.current = false;
        setLoading(false);
        if (queued.current) {
          queued.current = false;
          schedule();
        }
      });
  }, [schedule, sessionId]);
  useLayoutEffect(() => {
    loadRef.current = load;
  }, [load]);

  // A different session starts from nothing; responses for the previous one are dropped.
  useEffect(() => {
    generation.current += 1;
    revision.current = undefined;
    inFlight.current = false;
    queued.current = false;
    lastFetchAt.current = 0;
    setTrace(null);
    setError(null);
    setLoading(false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [sessionId]);

  // Showing the tab reads at once (the revision makes it free when nothing changed).
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // New session events, or the agent going idle, refresh at most once per throttle window.
  const live = status !== undefined && LIVE_STATUSES.has(status);
  const seen = useRef({ lastSeq, live });
  useEffect(() => {
    const before = seen.current;
    seen.current = { lastSeq, live };
    if (!active) return;
    if (lastSeq !== before.lastSeq || live !== before.live) schedule();
  }, [active, lastSeq, live, schedule]);

  // Hiding the tab drops a pending refresh; showing it again reads fresh anyway.
  useEffect(() => {
    if (active) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    queued.current = false;
  }, [active]);

  const refresh = useCallback(() => load(), [load]);

  return { trace, error, loading, live: trace?.live ?? live, refresh };
};
