import type { TraceNode } from '@/features/traces/types/TraceNode';

/** The ids of every node that has children: the collapsed set of "Collapse all". */
export const collectParentIds = (roots: readonly TraceNode[]): Set<string> => {
  const ids = new Set<string>();
  const walk = (nodes: readonly TraceNode[]) => {
    for (const node of nodes) {
      if (node.children.length === 0) continue;
      ids.add(node.span.id);
      walk(node.children);
    }
  };
  walk(roots);
  return ids;
};
