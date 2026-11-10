import { fiveHourLimit } from '@/features/sessions/lib/fiveHourLimit';
import type { Session } from '@/features/sessions/types/Session';
import type { UsageMetric } from '@/features/sessions/types/UsageMetric';

/** One index per `sessions` array: the store replaces the array on change, so a stale index is never read. */
const cache = new WeakMap<Session[], Map<string, UsageMetric>>();

/**
 * The freshest 5 hour reading per provider account. The limit belongs to the account, not to a
 * session: whichever of its sessions (or platform chats) read it last speaks for all of them, so
 * rows of one account never disagree. The metric objects are the sessions' own, so a selector
 * returning one only re-renders when the reading itself changes.
 */
export const accountFiveHourLimits = (sessions: Session[]): Map<string, UsageMetric> => {
  const cached = cache.get(sessions);
  if (cached) return cached;
  const limits = new Map<string, UsageMetric>();
  for (const session of sessions) {
    const metric = fiveHourLimit(session.usage);
    const current = limits.get(session.connectionId);
    if (metric?.percent != null && (!current || metric.updatedAt > current.updatedAt)) limits.set(session.connectionId, metric);
  }
  cache.set(sessions, limits);
  return limits;
};
