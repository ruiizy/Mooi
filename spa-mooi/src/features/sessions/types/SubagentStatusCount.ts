import type { SubagentStatus } from '@/features/sessions/types/SubagentStatus';

/** One state of a fan-out and how many of its agents are in it. */
export interface SubagentStatusCount {
  status: SubagentStatus;
  count: number;
}
