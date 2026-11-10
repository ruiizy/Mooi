import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TRACE_ROW_HEIGHT, TraceRow } from '@/features/traces/components/TraceRow';
import { formatSpanDuration } from '@/features/traces/lib/formatSpanDuration';
import type { TraceNode } from '@/features/traces/types/TraceNode';
import type { TraceTimeScale } from '@/features/traces/types/TraceTimeScale';

const OVERSCAN = 8;
const AXIS_HEIGHT = 28;

interface TraceTimelineProps {
  rows: readonly TraceNode[];
  scale: TraceTimeScale;
  now: number;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
  onSelect: (spanId: string) => void;
  onToggle: (spanId: string) => void;
}

/**
 * The span tree as a windowed list (fixed 40px rows, 8 rows of overscan), so thousands of spans stay
 * smooth. From `lg` a sticky time axis tops the waterfall column. The selected row is kept in view, so
 * keyboard navigation never leaves the viewport.
 */
export const TraceTimeline = ({ rows, scale, now, selectedId, collapsed, onSelect, onToggle }: TraceTimelineProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const [axis, setAxis] = useState(false);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      setHeight(element.clientHeight);
      setAxis(window.matchMedia('(min-width: 64rem)').matches);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const offset = axis ? AXIS_HEIGHT : 0;

  useEffect(() => {
    const element = scroller.current;
    if (!element || !selectedId) return;
    const index = rows.findIndex((row) => row.span.id === selectedId);
    if (index < 0) return;
    const top = offset + index * TRACE_ROW_HEIGHT;
    if (top - offset < element.scrollTop) element.scrollTop = top - offset;
    else if (top + TRACE_ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + TRACE_ROW_HEIGHT - element.clientHeight;
    }
  }, [offset, rows, selectedId]);

  const first = Math.max(0, Math.floor((scrollTop - offset) / TRACE_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop - offset + height) / TRACE_ROW_HEIGHT) + OVERSCAN);

  return (
    <div
      ref={scroller}
      role="tree"
      aria-label="Trace timeline"
      aria-activedescendant={selectedId ? `trace-row-${selectedId}` : undefined}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
    >
      {axis ? (
        <div
          aria-hidden
          className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_38%] border-b border-line bg-surface/95 backdrop-blur"
          style={{ height: AXIS_HEIGHT }}
        >
          <span className="flex items-center px-3 text-[11px] font-medium text-ink-subtle">Step</span>
          <span className="relative border-l border-line/60">
            <span className="absolute inset-x-3 inset-y-0">
              {scale.ticks.map((tick) => {
                const left = (tick / scale.durationMs) * 100;
                return (
                  <span
                    key={tick}
                    className="absolute inset-y-0 flex items-center border-l border-line pl-1 font-mono text-[10.5px] whitespace-nowrap text-ink-subtle tabular-nums"
                    style={{ left: `${left}%` }}
                  >
                    {left > 80 ? null : formatSpanDuration(tick)}
                  </span>
                );
              })}
            </span>
          </span>
        </div>
      ) : null}

      <div className="relative" style={{ height: rows.length * TRACE_ROW_HEIGHT }}>
        {rows.slice(first, last).map((node, index) => (
          <TraceRow
            key={node.span.id}
            node={node}
            scale={scale}
            now={now}
            selected={node.span.id === selectedId}
            expanded={!collapsed.has(node.span.id)}
            style={{ top: (first + index) * TRACE_ROW_HEIGHT, height: TRACE_ROW_HEIGHT }}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
};
