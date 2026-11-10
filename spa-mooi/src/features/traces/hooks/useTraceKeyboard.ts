import { useEffect, useLayoutEffect, useRef } from 'react';
import type { TraceNode } from '@/features/traces/types/TraceNode';

export interface TraceKeyboardOptions {
  /** Listen only while the Trace tab is visible. */
  enabled: boolean;
  /** The visible rows, in screen order (`flattenTraceTree`). */
  rows: readonly TraceNode[];
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  onSelect: (spanId: string) => void;
  onCollapsedChange: (spanId: string, collapsed: boolean) => void;
  /** Enter: open the selected span in the inspector. */
  onOpen: (spanId: string) => void;
  /** Esc: close the inspector. */
  onClose: () => void;
}

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement
  && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Desktop keyboard navigation of the timeline: ↑/↓ select the previous/next row (Home/End the first/last),
 * ← collapses an expanded row or moves to its parent, → expands a collapsed row or moves to its first
 * child, Enter opens the selected span, Esc closes the inspector. Keys typed in a field, or with a
 * modifier, are left alone. Options are read at key time, so the listener is bound once per `enabled`.
 */
export const useTraceKeyboard = (options: TraceKeyboardOptions): void => {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (!options.enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
      const { rows, selectedId, collapsed, onSelect, onCollapsedChange, onOpen, onClose } = latest.current;
      const index = selectedId ? rows.findIndex((row) => row.span.id === selectedId) : -1;
      const row = index >= 0 ? rows[index] : undefined;
      const select = (target: TraceNode | undefined) => {
        if (target) onSelect(target.span.id);
      };

      switch (event.key) {
        case 'ArrowDown':
          select(rows[index < 0 ? 0 : Math.min(rows.length - 1, index + 1)]);
          break;
        case 'ArrowUp':
          select(rows[index < 0 ? rows.length - 1 : Math.max(0, index - 1)]);
          break;
        case 'Home':
          select(rows[0]);
          break;
        case 'End':
          select(rows[rows.length - 1]);
          break;
        case 'ArrowLeft':
          if (!row) return;
          if (row.children.length > 0 && !collapsed.has(row.span.id)) onCollapsedChange(row.span.id, true);
          else select(rows.find((candidate) => candidate.span.id === row.span.parentId));
          break;
        case 'ArrowRight':
          if (!row || row.children.length === 0) return;
          if (collapsed.has(row.span.id)) onCollapsedChange(row.span.id, false);
          else select(rows[index + 1]?.depth > row.depth ? rows[index + 1] : undefined);
          break;
        case 'Enter':
          if (!row) return;
          onOpen(row.span.id);
          break;
        case 'Escape':
          onClose();
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [options.enabled]);
};
