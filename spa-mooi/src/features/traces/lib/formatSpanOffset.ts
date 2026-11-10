import { formatSpanDuration } from '@/features/traces/lib/formatSpanDuration';

/** When a span started, relative to the start of the trace: "+4.2s" (never negative). */
export const formatSpanOffset = (startMs: number, traceStartMs: number | null): string =>
  `+${formatSpanDuration(Math.max(0, startMs - (traceStartMs ?? startMs)))}`;
