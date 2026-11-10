import type { TraceFilter } from '@/features/traces/types/TraceFilter';
import type { TraceSpan } from '@/features/traces/types/TraceSpan';

/** Whether a span passes the kind chips, the errors toggle and the search text. */
export const spanMatchesFilter = (span: TraceSpan, filter: TraceFilter): boolean => {
  if (filter.kinds.length > 0 && !filter.kinds.includes(span.kind)) return false;
  if (filter.errorsOnly && span.status !== 'error') return false;
  const query = filter.query.trim().toLowerCase();
  if (!query) return true;
  return [span.name, span.title, span.model, span.preview].some((text) => text?.toLowerCase().includes(query));
};
