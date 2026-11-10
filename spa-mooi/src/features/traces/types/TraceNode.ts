import type { TraceSpan } from '@/features/traces/types/TraceSpan';

/** A span placed in the tree: children in start order, `descendants` counts every level below. */
export interface TraceNode {
  span: TraceSpan;
  depth: number;
  children: TraceNode[];
  descendants: number;
}
