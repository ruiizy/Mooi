import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';
import { formatDuration } from '@/shared/utils/formatDuration';

const EPOCH = new Date(0).toISOString();

/** The short facts the provider reported about a delegation's progress, in reading order. */
export const subagentMeta = (subagent: TranscriptSubagent): string[] => {
  const { usage } = subagent;
  const parts: string[] = [];
  if (subagent.lastToolName && (subagent.status === 'working' || subagent.status === 'started')) {
    parts.push(`Using ${subagent.lastToolName}`);
  }
  if (usage?.toolUses) parts.push(`${usage.toolUses} tool ${usage.toolUses === 1 ? 'use' : 'uses'}`);
  if (usage?.durationMs) parts.push(formatDuration(EPOCH, new Date(usage.durationMs).toISOString()));
  if (usage?.totalTokens) parts.push(`${usage.totalTokens.toLocaleString()} tokens`);
  if (subagent.model) parts.push(subagent.model);
  return parts;
};
