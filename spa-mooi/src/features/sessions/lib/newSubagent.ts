import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** A delegation as its `tool.use` describes it, before any lifecycle update arrives. */
export const newSubagent = (toolUseId: string, title: string, input: Record<string, unknown>): TranscriptSubagent => ({
  toolUseId,
  agentId: null,
  agentType: text(input.subagent_type),
  description: text(input.description) ?? text(title),
  prompt: text(input.prompt),
  model: text(input.model),
  status: 'started',
  detached: input.run_in_background === true,
  streamsActivity: true,
  lastToolName: null,
  usage: null,
  result: null,
  resultSource: null,
  blocks: [],
});
