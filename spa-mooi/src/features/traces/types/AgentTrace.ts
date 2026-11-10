import type { TraceSpan } from '@/features/traces/types/TraceSpan';
import type { TraceSummary } from '@/features/traces/types/TraceSummary';

/**
 * The trace of a session's agent, read from the provider's own session logs. `revision` changes with
 * every new log line; send it back to get `204` (no change). `conversations` counts the cleared ones too.
 */
export interface AgentTrace {
  revision: string;
  /** The agent is working, waiting or compacting: running spans still grow. */
  live: boolean;
  title: string | null;
  conversations: number;
  /** The span cap was reached: the oldest part of the trace is missing. */
  truncated: boolean;
  metadata: Record<string, unknown>;
  summary: TraceSummary;
  spans: TraceSpan[];
}
