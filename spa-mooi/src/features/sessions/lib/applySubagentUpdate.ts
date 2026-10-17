import { isTerminalSubagentStatus } from './isTerminalSubagentStatus';
import type { SubagentStatus } from '@/features/sessions/types/SubagentStatus';
import type { SubagentUsage } from '@/features/sessions/types/SubagentUsage';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

const STATUSES: SubagentStatus[] = ['started', 'working', 'waiting', 'completed', 'interrupted', 'failed'];

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/**
 * Merges one `subagent.updated` into a delegation. A foreground delegation that already ended stays
 * ended — late progress cannot revive it — while a detached agent may be resumed by its delegator.
 * A report (`result`) is the agent's own final word and wins; a summary only fills a missing result.
 */
export const applySubagentUpdate = (subagent: TranscriptSubagent, data: Record<string, unknown>): TranscriptSubagent => {
  const reported = STATUSES.find((status) => status === data.status);
  const detached = subagent.detached || data.detached === true;
  const frozen = !detached && isTerminalSubagentStatus(subagent.status) && reported && !isTerminalSubagentStatus(reported);
  const status = !reported || frozen || (reported === 'started' && subagent.status !== 'started') ? subagent.status : reported;

  const report = text(data.result);
  const summary = subagent.result === null ? text(data.summary) : null;

  return {
    ...subagent,
    status,
    detached,
    streamsActivity: data.streamsActivity === false ? false : subagent.streamsActivity,
    agentId: text(data.agentId) ?? text(data.taskId) ?? subagent.agentId,
    agentType: subagent.agentType ?? text(data.agentType),
    description: subagent.description ?? text(data.description),
    lastToolName: text(data.lastToolName) ?? subagent.lastToolName,
    usage: data.usage && typeof data.usage === 'object' ? { ...subagent.usage, ...(data.usage as SubagentUsage) } : subagent.usage,
    ...(report ? { result: report, resultSource: 'report' as const }
      : summary ? { result: summary, resultSource: 'summary' as const } : {}),
  };
};
