import type { TraceFilter } from '@/features/traces/types/TraceFilter';

export const isTraceFilterActive = (filter: TraceFilter): boolean =>
  filter.kinds.length > 0 || filter.errorsOnly || filter.query.trim() !== '';
