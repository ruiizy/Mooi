import type { TraceSpanKind } from '@/features/traces/types/TraceSpanKind';
import type { TraceSpanStatus } from '@/features/traces/types/TraceSpanStatus';
import type { TraceUsage } from '@/features/traces/types/TraceUsage';

/**
 * One row of the trace, as `GET /sessions/{id}/trace` sends it (sorted by `startMs`). Times are epoch
 * milliseconds; `endMs` is `null` while the span runs. Optional fields are omitted when empty.
 */
export interface TraceSpan {
  id: string;
  parentId: string | null;
  kind: TraceSpanKind;
  name: string;
  status: TraceSpanStatus;
  startMs: number;
  endMs: number | null;
  title?: string;
  model?: string;
  stopReason?: string;
  /** At most 160 characters; the full input and output come from the span detail. */
  preview?: string;
  usage?: TraceUsage;
}
