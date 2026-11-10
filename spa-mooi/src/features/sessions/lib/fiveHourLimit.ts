import type { SessionUsage } from '@/features/sessions/types/SessionUsage';
import type { UsageMetric } from '@/features/sessions/types/UsageMetric';

/** The account's short window under each provider's name: Claude's `five_hour`, Codex's `primary`. */
export const fiveHourLimit = (usage: SessionUsage | undefined): UsageMetric | undefined =>
  usage?.quota?.five_hour ?? usage?.quota?.primary;
