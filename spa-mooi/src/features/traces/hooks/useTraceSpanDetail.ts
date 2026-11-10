import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTraceSpan } from '@/features/traces/api/tracesApi';
import type { TraceSpanDetail } from '@/features/traces/types/TraceSpanDetail';

/** Details kept per session, so stepping back and forth through spans reads each one once. */
const CACHE_SIZE = 64;

const cacheKey = (spanId: string, revision: string | null) => `${spanId}@${revision ?? ''}`;

/**
 * The full input, output and metadata of the selected span, read on demand (FR5). Pass the trace
 * `revision` while the span is still running, so its growing content is read again as the trace moves,
 * and `null` once it has finished, so it is read once. The previous detail stays shown while the next
 * one loads; `spanId` `null` clears it.
 */
export const useTraceSpanDetail = (sessionId: string, spanId: string | null, revision: string | null) => {
  const cache = useRef(new Map<string, TraceSpanDetail>());
  const [detail, setDetail] = useState<TraceSpanDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    cache.current.clear();
  }, [sessionId]);

  useEffect(() => {
    if (!spanId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    const key = cacheKey(spanId, revision);
    const cached = cache.current.get(key);
    if (cached) {
      setDetail(cached);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTraceSpan(sessionId, spanId)
      .then((next) => {
        if (cancelled) return;
        const entries = cache.current;
        entries.set(key, next);
        if (entries.size > CACHE_SIZE) entries.delete(entries.keys().next().value as string);
        setDetail(next);
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, revision, sessionId, spanId]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // A detail of another span is never shown as this one's.
  const current = detail && detail.id === spanId ? detail : null;

  return { detail: current, loading, error, retry };
};
