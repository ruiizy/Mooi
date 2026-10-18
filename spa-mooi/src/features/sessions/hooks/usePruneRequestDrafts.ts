import { useEffect, useRef } from 'react';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import { useRequestDraftsStore } from '@/stores/requestDraftsStore';

/**
 * Drops the draft of every request that left this session's pending queue. Each session remembers
 * its own queue, so switching sessions never reads another session's empty queue as "all resolved".
 */
export const usePruneRequestDrafts = (sessionId: string, pending: SessionPendingRequest[]): void => {
  const seen = useRef(new Map<string, string[]>());

  useEffect(() => {
    const current = new Set(pending.map((request) => request.requestId));
    const gone = (seen.current.get(sessionId) ?? []).filter((id) => !current.has(id));
    seen.current.set(sessionId, [...current]);
    if (gone.length) useRequestDraftsStore.getState().discard(gone);
  }, [sessionId, pending]);
};
