import { ChevronRight } from 'lucide-react';
import { formatSpanOffset } from '@/features/traces/lib/formatSpanOffset';
import { traceKindStyle } from '@/features/traces/lib/traceKindStyle';
import type { TraceSpan } from '@/features/traces/types/TraceSpan';
import { cn } from '@/shared/utils/cn';

interface TraceErrorListProps {
  errors: readonly TraceSpan[];
  traceStartMs: number | null;
  onOpenSpan: (spanId: string) => void;
  /** Rows shown at most; the rest is counted. */
  limit?: number;
}

/** Spans that failed (FR6), in start order; each opens in the Timeline inspector. */
export const TraceErrorList = ({ errors, traceStartMs, onOpenSpan, limit = 50 }: TraceErrorListProps) => {
  if (errors.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-ink-muted">No error in this trace.</p>;
  }
  const shown = errors.slice(0, limit);

  return (
    <div className="flex min-w-0 flex-col">
      <ul className="-mx-2 flex min-w-0 flex-col">
        {shown.map((span) => {
          const style = traceKindStyle(span.kind, span.status);
          const Icon = style.icon;
          return (
            <li key={span.id}>
              <button
                type="button"
                onClick={() => onOpenSpan(span.id)}
                title={[span.name, span.title, span.preview].filter(Boolean).join(' — ')}
                className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
              >
                <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-chip', style.chip)}>
                  <Icon aria-hidden className="size-3.5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-ink">{span.name}</span>
                  {span.preview || span.title ? (
                    <span className="truncate text-[12px] text-danger">{span.preview ?? span.title}</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ink-subtle tabular-nums">{formatSpanOffset(span.startMs, traceStartMs)}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-subtle" />
              </button>
            </li>
          );
        })}
      </ul>
      {errors.length > shown.length ? (
        <p className="mt-2 text-[12px] text-ink-subtle">
          {errors.length - shown.length} more — filter the Timeline with “Errors only” to see them all.
        </p>
      ) : null}
    </div>
  );
};
