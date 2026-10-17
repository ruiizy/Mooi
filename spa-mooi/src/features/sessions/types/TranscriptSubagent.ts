import type { SubagentStatus } from '@/features/sessions/types/SubagentStatus';
import type { SubagentUsage } from '@/features/sessions/types/SubagentUsage';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';

/**
 * One delegation of work to another agent, keyed by the tool call that delegated it. Every detail
 * is null until — and unless — the provider reports it; the transcript never guesses one.
 */
export interface TranscriptSubagent {
  toolUseId: string;
  /** The provider's id for the delegated agent (Claude task, Codex thread), once reported. */
  agentId: string | null;
  agentType: string | null;
  description: string | null;
  /** The instructions and context sent to the agent. */
  prompt: string | null;
  model: string | null;
  status: SubagentStatus;
  /** Keeps working after the delegating call returns, so the main turn ending does not stop it. */
  detached: boolean;
  /** False when the provider never streams the agent's own activity to this session. */
  streamsActivity: boolean;
  lastToolName: string | null;
  usage: SubagentUsage | null;
  result: string | null;
  /** Where `result` came from, most trusted first: the agent's own report, the delegating call's
   * result, or the provider's short completion summary. A weaker source never replaces a stronger. */
  resultSource: 'report' | 'call' | 'summary' | null;
  /** The agent's own text, reasoning, tool steps and nested delegations, in order. */
  blocks: TranscriptBlock[];
}
