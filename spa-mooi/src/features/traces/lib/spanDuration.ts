import type { TraceSpan } from '@/features/traces/types/TraceSpan';

/** How long a span took; a running one is measured up to `now` (epoch ms). */
export const spanDuration = (span: Pick<TraceSpan, 'startMs' | 'endMs' | 'status'>, now: number): number => {
  const end = span.endMs ?? (span.status === 'running' ? now : span.startMs);
  return Math.max(0, end - span.startMs);
};
