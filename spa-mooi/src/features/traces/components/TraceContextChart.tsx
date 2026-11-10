import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { formatTokens } from '@/features/traces/lib/formatTokens';
import type { TraceContextBar } from '@/features/traces/types/TraceContextBar';
import { Button } from '@/shared/components/Button';
import { cn } from '@/shared/utils/cn';

interface TraceContextChartProps {
  bars: readonly TraceContextBar[];
  /** Opens a request in the Timeline inspector. */
  onOpenSpan: (spanId: string) => void;
}

/** Stack order (bottom-up) and fills; the legend reads the same list. */
const PARTS = [
  { key: 'cacheRead', label: 'Cache read', fill: 'fill-info-dot', dot: 'bg-info-dot' },
  { key: 'cacheWrite', label: 'Cache write', fill: 'fill-accent-dot', dot: 'bg-accent-dot' },
  { key: 'input', label: 'New input', fill: 'fill-brand', dot: 'bg-brand' },
  { key: 'output', label: 'Output', fill: 'fill-success-dot', dot: 'bg-success-dot' },
] as const;

const HEIGHT = 100;
const SLOT = 10;
const GAP = 2;

const exact = (value: number) => value.toLocaleString('en');

/**
 * Context size per model request (FR6) as stacked SVG bars on a fixed-height plot that stretches to the
 * card width. Hover (desktop) previews a request, click / tap pins it, ←/→ move the pinned one; the
 * readout below gives the exact breakdown and opens the request in the Timeline.
 */
export const TraceContextChart = ({ bars, onOpenSpan }: TraceContextChartProps) => {
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const max = useMemo(() => bars.reduce((top, bar) => Math.max(top, bar.context + bar.output), 0), [bars]);
  const shownIndex = hovered ?? pinned;
  const shown = shownIndex !== null ? bars[shownIndex] ?? null : null;
  const peak = useMemo(
    () => bars.reduce<TraceContextBar | null>((best, bar) => (!best || bar.context > best.context ? bar : best), null),
    [bars],
  );
  const readout = shown ?? peak;
  const width = Math.max(bars.length, 1) * SLOT;
  const bucketed = bars.some((bar) => bar.calls > 1);

  const indexAt = (event: MouseEvent<HTMLDivElement>): number => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    return Math.min(bars.length - 1, Math.max(0, Math.floor(ratio * bars.length)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const last = bars.length - 1;
    const current = pinned ?? (event.key === 'ArrowLeft' ? last + 1 : -1);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : current + (event.key === 'ArrowLeft' ? -1 : 1);
    setPinned(Math.min(last, Math.max(0, next)));
  };

  if (bars.length === 0 || max === 0) {
    return <p className="px-1 py-8 text-center text-sm text-ink-muted">No model request with token usage yet.</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-muted" aria-label="Legend">
        {PARTS.map((part) => (
          <li key={part.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2.5 rounded-[3px]', part.dot)} />
            {part.label}
          </li>
        ))}
      </ul>

      <div className="flex min-w-0 gap-2">
        <div aria-hidden className="flex w-9 shrink-0 flex-col justify-between py-px text-right font-mono text-[10px] text-ink-subtle tabular-nums">
          <span>{formatTokens(max)}</span>
          <span>{formatTokens(max / 2)}</span>
          <span>0</span>
        </div>
        <div
          role="group"
          tabIndex={0}
          aria-label={`Context size of ${bars.length} model requests; use the left and right arrows to inspect one`}
          onKeyDown={onKeyDown}
          onPointerMove={(event) => {
            if (event.pointerType === 'mouse') setHovered(indexAt(event));
          }}
          onPointerLeave={() => setHovered(null)}
          onClick={(event) => {
            const index = indexAt(event);
            setPinned((current) => (current === index ? null : index));
          }}
          className="relative h-40 min-w-0 flex-1 cursor-crosshair touch-pan-y rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-48"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            <span className="border-t border-dashed border-line" />
            <span className="border-t border-dashed border-line" />
            <span className="border-t border-line-strong" />
          </div>
          <svg
            aria-hidden
            viewBox={`0 0 ${width} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {bars.map((bar, index) => {
              const dimmed = shownIndex !== null && shownIndex !== index;
              let top = HEIGHT;
              return (
                <g key={bar.spanId} className={cn('transition-opacity duration-150', dimmed && 'opacity-35')}>
                  {PARTS.map((part) => {
                    const value = bar[part.key];
                    if (value <= 0) return null;
                    const height = (value / max) * HEIGHT;
                    top -= height;
                    return (
                      <rect
                        key={part.key}
                        x={index * SLOT + GAP / 2}
                        y={top}
                        width={SLOT - GAP}
                        height={height}
                        className={part.fill}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {readout ? (
        <div
          aria-live="polite"
          className="flex min-w-0 flex-col gap-2 rounded-control border border-line bg-surface-2/60 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
        >
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12px] text-ink-muted">
              <span className="font-semibold text-ink">
                {shown ? `Request #${readout.index}` : `Peak · request #${readout.index}`}
              </span>
              {readout.model ? <span className="min-w-0 truncate font-mono" title={readout.model}>{readout.model}</span> : null}
              {readout.subAgent ? <span className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] text-accent">sub-agent</span> : null}
              {readout.calls > 1 ? <span className="text-ink-subtle">largest of {readout.calls}</span> : null}
            </p>
            <p className="mt-1 font-mono text-[12px] text-ink tabular-nums" title={`Context ${exact(readout.context)} tokens`}>
              <span className="font-semibold">{formatTokens(readout.context)}</span>
              <span className="text-ink-subtle"> context · </span>
              {PARTS.map((part, index) => (
                <span key={part.key} title={`${part.label}: ${exact(readout[part.key])}`}>
                  {index > 0 ? <span className="text-ink-subtle"> · </span> : null}
                  <span className={cn('mr-1 inline-block size-2 rounded-[2px] align-middle', part.dot)} />
                  {formatTokens(readout[part.key])}
                </span>
              ))}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onOpenSpan(readout.spanId)} className="shrink-0 self-start sm:self-auto">
            Open in timeline
            <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {bucketed ? (
        <p className="text-[11px] text-ink-subtle">
          Long trace: each bar shows the largest of {bars[0]?.calls ?? 1} consecutive requests.
        </p>
      ) : null}
    </div>
  );
};
