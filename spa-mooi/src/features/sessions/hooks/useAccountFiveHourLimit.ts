import { accountFiveHourLimits } from '@/features/sessions/lib/accountFiveHourLimits';
import type { UsageMetric } from '@/features/sessions/types/UsageMetric';
import { useSessionsStore } from '@/stores/sessionsStore';

/** The account's latest 5 hour reading, shared by every session on that account. */
export const useAccountFiveHourLimit = (connectionId: string): UsageMetric | undefined =>
  useSessionsStore((state) => accountFiveHourLimits(state.sessions).get(connectionId));
