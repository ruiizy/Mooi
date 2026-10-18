import type { SessionSubagents } from '@/features/sessions/types/SessionSubagents';
import type { SubagentStatusCount } from '@/features/sessions/types/SubagentStatusCount';

/** What a session row reports about its delegations, the player's turn first. Empty when idle. */
export const sessionSubagentCounts = (subagents?: SessionSubagents): SubagentStatusCount[] => [
  { status: 'waiting' as const, count: subagents?.waiting ?? 0 },
  { status: 'working' as const, count: subagents?.working ?? 0 },
].filter(({ count }) => count > 0);
