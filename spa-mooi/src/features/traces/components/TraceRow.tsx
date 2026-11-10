import type { CSSProperties } from 'react';
import { ChevronRight, CircleDashed, CircleSlash, CircleX, LoaderCircle } from 'lucide-react';
import { formatSpanDuration } from '@/features/traces/lib/formatSpanDuration';
import { formatTokens } from '@/features/traces/lib/formatTokens';
import { spanDuration } from '@/features/traces/lib/spanDuration';
import { traceKindStyle } from '@/features/traces/lib/traceKindStyle';
import type { TraceNode } from '@/features/traces/types/TraceNode';
import type { TraceSpanStatus } from '@/features/traces/types/TraceSpanStatus';
import type { TraceTimeScale } from '@/features/traces/types/TraceTimeScale';
import { cn } from '@/shared/utils/cn';

/** Fixed row height of the windowed timeline, in px. */
export const TRACE_ROW_HEIGHT = 40;

const INDENT = 16;

interface TraceRowProps {
  node: TraceNode;
  scale: TraceTimeScale;
  now: number;
  selected: boolean;
  expanded: boolean;
  /** The row's position in the windowed list (absolute `top`). */
  style: CSSProperties;
  onSelect: (spanId: string) => void;
  onToggle: (spanId: string) => void;
}

const STATUS: Partial<Record<TraceSpanStatus, { icon: typeof CircleX; label: string; className: string }>> = {
  running: { icon: LoaderCircle, label: 'Running', className: 'animate-spin text-info' },
  error: { icon: CircleX, label: 'Error', className: 'text-danger' },
  interrupted: { icon: CircleSlash, label: 'Interrupted', className: 'text-warning' },
  incomplete: { icon: CircleDashed, label: 'Incomplete', className: 'text-ink-subtle' },
};

/**
 * One span of the timeline (FR3): indent guides, chevron, kind icon, name and title, model and token
 * badges, status and duration. From `lg` a waterfall column (38 %) places the span on the shared time
 * axis; on phones the same bar is a 3px line under the row. Clicking selects (and opens) the span.
 */
export const TraceRow = ({ node, scale, now, selected, expanded, style, onSelect, onToggle }: TraceRowProps) => {
  const { span, depth } = node;
  const kind = traceKindStyle(span.kind, span.status);
  const KindIcon = kind.icon;
  const status = STATUS[span.status];
  const StatusIcon = status?.icon;
  const duration = spanDuration(span, now);
  const end = span.startMs + duration;
  const left = scale.percent(span.startMs);
  const width = Math.max(0, scale.percent(end) - left);
  const hasChildren = node.children.length > 0;
  const usage = span.usage;
  const label = span.title ? `${span.name} — ${span.title}` : span.name;
  const tokenDetail = usage
    ? `Context ${usage.context.toLocaleString('en')} · input ${usage.input.toLocaleString('en')} · cache read ${usage.cacheRead.toLocaleString('en')} · cache write ${usage.cacheWrite.toLocaleString('en')} · output ${usage.output.toLocaleString('en')}${usage.reasoning ? ` · reasoning ${usage.reasoning.toLocaleString('en')}` : ''}`
    : undefined;

  const bar = (
    <span
      aria-hidden
      className={cn('absolute inset-y-0 rounded-full', kind.bar, span.status === 'running' && 'animate-pulse-soft', span.status === 'error' && 'bg-danger-dot')}
      style={{ left: `${left}%`, width: `max(${width}%, 3px)` }}
    />
  );

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      id={`trace-row-${span.id}`}
      style={style}
      onClick={() => onSelect(span.id)}
      className={cn(
        'group absolute inset-x-0 grid cursor-pointer select-none grid-cols-1 border-b border-line/60 transition-colors duration-100 lg:grid-cols-[minmax(0,1fr)_38%]',
        selected ? 'bg-brand-soft' : 'hover:bg-surface-2/70',
      )}
    >
      <div className="relative flex min-w-0 items-center gap-1.5 pr-3 pl-2 sm:pl-3" style={{ height: TRACE_ROW_HEIGHT }}>
        {Array.from({ length: depth }, (_, level) => (
          <span key={level} aria-hidden className="relative h-full shrink-0" style={{ width: INDENT }}>
            <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
          </span>
        ))}

        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? `Collapse ${span.name}` : `Expand ${span.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(span.id);
            }}
            className="-my-1 flex size-7 shrink-0 items-center justify-center rounded-chip text-ink-subtle transition hover:bg-surface-3 hover:text-ink"
          >
            <ChevronRight className={cn('size-3.5 transition-transform duration-150', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span aria-hidden className="size-7 shrink-0" />
        )}

        <span aria-hidden className={cn('flex size-6 shrink-0 items-center justify-center rounded-chip', kind.chip)}>
          <KindIcon className="size-3.5" />
        </span>

        <span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={label}>
          <span className={cn('shrink-0 truncate text-[13px] font-medium text-ink', span.title ? 'max-w-[55%]' : 'max-w-full')}>{span.name}</span>
          {span.title ? <span className="min-w-0 truncate text-[12px] text-ink-muted">{span.title}</span> : null}
          {!hasChildren || expanded ? null : (
            <span className="shrink-0 font-mono text-[10.5px] text-ink-subtle tabular-nums">+{node.descendants}</span>
          )}
        </span>

        {span.model ? (
          <span title={span.model} className="hidden max-w-32 shrink-0 truncate rounded-full bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-ink-muted sm:inline">
            {span.model}
          </span>
        ) : null}
        {usage ? (
          <span title={tokenDetail} aria-label={tokenDetail} className="shrink-0 rounded-full bg-info-soft px-1.5 py-px font-mono text-[10.5px] text-info tabular-nums">
            {formatTokens(usage.context)}
            <span className="text-info/60"> → </span>
            {formatTokens(usage.output)}
          </span>
        ) : null}
        {status && StatusIcon ? (
          <span title={status.label} className="flex shrink-0">
            <StatusIcon aria-label={status.label} className={cn('size-3.5', status.className)} />
          </span>
        ) : null}
        <span className={cn('w-12 shrink-0 text-right font-mono text-[11px] tabular-nums', span.status === 'error' ? 'text-danger' : 'text-ink-subtle')}>
          {formatSpanDuration(duration)}
        </span>

        <span aria-hidden className="absolute inset-x-3 bottom-1 h-[3px] lg:hidden">{bar}</span>
      </div>

      <div aria-hidden className="relative hidden border-l border-line/60 px-3 lg:block">
        <span className="absolute inset-x-3 top-1/2 h-2 -translate-y-1/2">{bar}</span>
      </div>
    </div>
  );
};
