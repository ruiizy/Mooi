import type { TraceSpanKind } from '@/features/traces/types/TraceSpanKind';

/** What the timeline shows. An empty `kinds` list means every kind. */
export interface TraceFilter {
  kinds: readonly TraceSpanKind[];
  errorsOnly: boolean;
  /** Free text matched, case-insensitively, against name, title, model and preview. */
  query: string;
}
