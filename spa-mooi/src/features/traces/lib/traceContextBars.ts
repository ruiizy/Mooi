import type { TraceContextBar } from '@/features/traces/types/TraceContextBar';
import type { TraceSpan } from '@/features/traces/types/TraceSpan';

/**
 * The context chart's bars: every model request with usage, in start order, main conversation only
 * unless `includeSubAgents`. Above `maxBars` requests, consecutive ones are bucketed and each bucket
 * shows its largest request, so peaks are never smoothed away and the chart stays light.
 */
export const traceContextBars = (
  spans: readonly TraceSpan[],
  includeSubAgents: boolean,
  maxBars = 240,
): TraceContextBar[] => {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const inSubAgent = (span: TraceSpan): boolean => {
    const seen = new Set<string>();
    let parentId = span.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return false;
      if (parent.kind === 'agent') return true;
      parentId = parent.parentId;
    }
    return false;
  };

  const requests: TraceContextBar[] = [];
  for (const span of spans) {
    if (span.kind !== 'llm' || !span.usage) continue;
    const subAgent = inSubAgent(span);
    if (subAgent && !includeSubAgents) continue;
    const { cacheRead, cacheWrite, input, output, context } = span.usage;
    requests.push({
      spanId: span.id,
      index: requests.length + 1,
      calls: 1,
      model: span.model,
      startMs: span.startMs,
      cacheRead,
      cacheWrite,
      input,
      output,
      context: context || cacheRead + cacheWrite + input,
      subAgent,
    });
  }
  if (requests.length <= maxBars) return requests;

  const size = Math.ceil(requests.length / maxBars);
  const bars: TraceContextBar[] = [];
  for (let start = 0; start < requests.length; start += size) {
    const bucket = requests.slice(start, start + size);
    const peak = bucket.reduce((best, bar) => (bar.context + bar.output > best.context + best.output ? bar : best));
    bars.push({ ...peak, calls: bucket.length });
  }
  return bars;
};
