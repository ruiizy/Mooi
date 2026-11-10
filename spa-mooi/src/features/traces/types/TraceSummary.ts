import type { TraceModelStat } from '@/features/traces/types/TraceModelStat';
import type { TraceSpanKind } from '@/features/traces/types/TraceSpanKind';
import type { TraceToolStat } from '@/features/traces/types/TraceToolStat';

/** Totals of the whole trace, computed by the backend over every span. */
export interface TraceSummary {
  /** `null` when the trace has no span yet. */
  startMs: number | null;
  endMs: number | null;
  counts: Record<TraceSpanKind, number>;
  errors: number;
  tokens: { input: number; cacheRead: number; cacheWrite: number; output: number; reasoning: number; total: number };
  /** Share of the prompt served from cache (0–1), `null` without model requests. */
  cacheHitRate: number | null;
  /** Largest context of a main-conversation request (sub-agents excluded), `null` without one. */
  peakContext: number | null;
  models: TraceModelStat[];
  tools: TraceToolStat[];
}
