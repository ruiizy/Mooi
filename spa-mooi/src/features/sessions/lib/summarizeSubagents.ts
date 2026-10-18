import type { SubagentStatusCount } from '@/features/sessions/types/SubagentStatusCount';
import type { SubagentStatus } from '@/features/sessions/types/SubagentStatus';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

/** Most urgent first: what needs the player, then what is moving, then how the rest ended. */
const ORDER: SubagentStatus[] = ['waiting', 'working', 'failed', 'interrupted', 'completed'];

/**
 * Every state present keeps its own count: collapsing a mixed fan-out into its most urgent state
 * would say "failed" over children still at work. `started` counts as working.
 */
export const summarizeSubagents = (subagents: TranscriptSubagent[]): SubagentStatusCount[] =>
  ORDER.flatMap((status) => {
    const count = subagents.filter((subagent) =>
      (subagent.status === 'started' ? 'working' : subagent.status) === status).length;
    return count > 0 ? [{ status, count }] : [];
  });
