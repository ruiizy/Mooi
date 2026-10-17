/** What a delegated agent has spent so far; each figure only when its provider reports it. */
export interface SubagentUsage {
  totalTokens?: number | null;
  toolUses?: number | null;
  durationMs?: number | null;
}
