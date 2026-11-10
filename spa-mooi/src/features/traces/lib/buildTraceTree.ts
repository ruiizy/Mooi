import type { TraceNode } from '@/features/traces/types/TraceNode';
import type { TraceSpan } from '@/features/traces/types/TraceSpan';

/**
 * Nests the flat span list (already in start order) into root nodes. A span whose parent is missing
 * (cut by the span cap) becomes a root, so nothing is ever dropped.
 */
export const buildTraceTree = (spans: readonly TraceSpan[]): TraceNode[] => {
  const nodes = new Map<string, TraceNode>();
  for (const span of spans) {
    nodes.set(span.id, { span, depth: 0, children: [], descendants: 0 });
  }

  const roots: TraceNode[] = [];
  for (const span of spans) {
    const node = nodes.get(span.id);
    const parent = span.parentId && span.parentId !== span.id ? nodes.get(span.parentId) : undefined;
    if (!node) continue;
    (parent ? parent.children : roots).push(node);
  }

  const place = (node: TraceNode, depth: number): number => {
    node.depth = depth;
    node.descendants = node.children.reduce((total, child) => total + 1 + place(child, depth + 1), 0);
    return node.descendants;
  };
  for (const root of roots) {
    place(root, 0);
  }
  return roots;
};
