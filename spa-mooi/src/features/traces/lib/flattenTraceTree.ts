import { isTraceFilterActive } from '@/features/traces/lib/isTraceFilterActive';
import { spanMatchesFilter } from '@/features/traces/lib/spanMatchesFilter';
import type { TraceFilter } from '@/features/traces/types/TraceFilter';
import type { TraceNode } from '@/features/traces/types/TraceNode';

/**
 * The rows the timeline shows, in display order. Without a filter, collapsed nodes hide their
 * subtree. With one, a node shows when it matches or leads to a match; ancestors of matches stay open
 * whatever the collapsed set says, so a match is never hidden.
 */
export const flattenTraceTree = (
  roots: readonly TraceNode[],
  collapsed: ReadonlySet<string>,
  filter: TraceFilter,
): TraceNode[] => {
  const rows: TraceNode[] = [];

  if (!isTraceFilterActive(filter)) {
    const walk = (nodes: readonly TraceNode[]) => {
      for (const node of nodes) {
        rows.push(node);
        if (!collapsed.has(node.span.id)) walk(node.children);
      }
    };
    walk(roots);
    return rows;
  }

  /** Appends the visible part of a subtree; returns whether anything in it matched. */
  const visit = (node: TraceNode): boolean => {
    const index = rows.length;
    rows.push(node);
    let leads = false;
    for (const child of node.children) {
      leads = visit(child) || leads;
    }
    if (!leads && !spanMatchesFilter(node.span, filter)) {
      rows.length = index;
      return false;
    }
    return true;
  };
  for (const root of roots) {
    visit(root);
  }
  return rows;
};
