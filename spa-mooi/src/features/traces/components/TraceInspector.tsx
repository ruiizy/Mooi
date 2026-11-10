import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, CircleCheck, CircleDashed, CircleSlash, CircleX, LoaderCircle, RotateCw, X } from 'lucide-react';
import { TraceDetailSection } from '@/features/traces/components/TraceDetailSection';
import { useSwipeGestures, type SwipeAxis } from '@/features/traces/hooks/useSwipeGestures';
import { useTraceSpanDetail } from '@/features/traces/hooks/useTraceSpanDetail';
import { useWideLayout } from '@/features/traces/hooks/useWideLayout';
import { formatSpanDuration } from '@/features/traces/lib/formatSpanDuration';
import { formatSpanOffset } from '@/features/traces/lib/formatSpanOffset';
import { formatTokens } from '@/features/traces/lib/formatTokens';
import { spanDuration } from '@/features/traces/lib/spanDuration';
import { traceKindStyle } from '@/features/traces/lib/traceKindStyle';
import type { TraceNode } from '@/features/traces/types/TraceNode';
import type { TraceSpan } from '@/features/traces/types/TraceSpan';
import type { TraceSpanStatus } from '@/features/traces/types/TraceSpanStatus';
import { Button } from '@/shared/components/Button';
import { IconButton } from '@/shared/components/IconButton';
import { useLockBodyScroll } from '@/shared/hooks/useLockBodyScroll';
import { cn } from '@/shared/utils/cn';

interface TraceInspectorProps {
  sessionId: string;
  span: TraceSpan;
  /** The trace revision: re-reads the detail of a running span as the trace moves (D10). */
  revision: string;
  /** Start of the trace, for the span's start offset. */
  traceStartMs: number | null;
  now: number;
  /** The visible timeline rows: previous / next span (buttons, swipe left / right). */
  rows: readonly TraceNode[];
  onSelect: (spanId: string) => void;
  onClose: () => void;
}

const STATUS: Record<TraceSpanStatus, { icon: typeof CircleX; label: string; className: string }> = {
  running: { icon: LoaderCircle, label: 'Running', className: 'bg-info-soft text-info [&>svg]:animate-spin' },
  ok: { icon: CircleCheck, label: 'OK', className: 'bg-success-soft text-success' },
  error: { icon: CircleX, label: 'Error', className: 'bg-danger-soft text-danger' },
  interrupted: { icon: CircleSlash, label: 'Interrupted', className: 'bg-warning-soft text-warning' },
  incomplete: { icon: CircleDashed, label: 'Incomplete', className: 'bg-surface-2 text-ink-subtle' },
};

/** Horizontal drags follow the finger at this ratio: a hint that the sheet changes span, not a move. */
const SIDE_DRAG = 0.35;

/**
 * The selected span in full (FR5): header (kind, name, status, start offset, duration), metrics (model,
 * stop reason, every token count, context) and the Input / Output / Metadata read on demand. From `lg`
 * it is the 420px pane beside the timeline; on phones a bottom sheet: swipe down (from its header, or
 * anywhere once scrolled to the top) closes it, swipe left / right steps to the next / previous row.
 */
export const TraceInspector = ({ sessionId, span, revision, traceStartMs, now, rows, onSelect, onClose }: TraceInspectorProps) => {
  const wide = useWideLayout();
  const scroller = useRef<HTMLDivElement>(null);
  const { detail, loading, error, retry } = useTraceSpanDetail(sessionId, span.id, span.status === 'running' ? revision : null);

  const index = rows.findIndex((node) => node.span.id === span.id);
  const previousId = index > 0 ? rows[index - 1].span.id : null;
  const nextId = index >= 0 && index < rows.length - 1 ? rows[index + 1].span.id : null;

  // A new span is read from its top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [span.id]);

  const kind = traceKindStyle(span.kind, span.status);
  const KindIcon = kind.icon;
  const status = STATUS[span.status];
  const StatusIcon = status.icon;
  const metadata = detail && Object.keys(detail.metadata).length > 0 ? JSON.stringify(detail.metadata, null, 2) : null;

  const header = (
    <div className="flex min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={cn('inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[11px] font-semibold', kind.chip)}>
            <KindIcon className="size-3" />
            {kind.label}
          </span>
          <span className={cn('inline-flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-[11px] font-semibold', status.className)}>
            <StatusIcon className="size-3" />
            {status.label}
          </span>
        </div>
        <h3 className="mt-1.5 truncate text-[15px] font-semibold tracking-[-0.01em] text-ink" title={span.name}>
          {span.name}
        </h3>
        {span.title ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] break-words text-ink-muted" title={span.title}>
            {span.title}
          </p>
        ) : null}
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-subtle tabular-nums">
          <span title="Start, from the beginning of the trace">{formatSpanOffset(span.startMs, traceStartMs)}</span>
          <span title="Duration">{formatSpanDuration(spanDuration(span, now))}</span>
          {index >= 0 ? <span title="Position in the timeline">{index + 1} / {rows.length}</span> : null}
        </p>
      </div>
      <div className="-mt-1 -mr-1 flex shrink-0 items-center">
        <IconButton icon={ChevronUp} label="Previous step" onClick={previousId ? () => onSelect(previousId) : undefined} className={cn('max-lg:size-11', !previousId && 'pointer-events-none opacity-40')} />
        <IconButton icon={ChevronDown} label="Next step" onClick={nextId ? () => onSelect(nextId) : undefined} className={cn('max-lg:size-11', !nextId && 'pointer-events-none opacity-40')} />
        <IconButton icon={X} label="Close inspector" onClick={onClose} className="max-lg:size-11" />
      </div>
    </div>
  );

  const body = (
    <>
      <TraceMetrics span={span} />
      {error ? (
        <div role="alert" className="mx-3 mb-3 flex items-center gap-3 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button variant="danger" size="sm" onClick={retry}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </div>
      ) : null}
      <TraceDetailSection title="Input" value={detail?.input ?? null} loading={loading && !detail} />
      <TraceDetailSection title="Output" value={detail?.output ?? null} loading={loading && !detail} emptyLabel={span.status === 'running' ? 'No output yet' : 'Nothing recorded'} />
      <TraceDetailSection title="Metadata" value={metadata} loading={loading && !detail} defaultOpen={false} emptyLabel="No metadata" />
    </>
  );

  if (wide) {
    return (
      <aside aria-label="Step inspector" className="flex min-h-0 min-w-0 flex-col border-l border-line bg-surface">
        <div className="shrink-0 border-b border-line px-4 py-3">{header}</div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {body}
        </div>
      </aside>
    );
  }

  return (
    <TraceInspectorSheet
      scroller={scroller}
      header={header}
      onClose={onClose}
      onNext={nextId ? () => onSelect(nextId) : undefined}
      onPrevious={previousId ? () => onSelect(previousId) : undefined}
    >
      {body}
    </TraceInspectorSheet>
  );
};

/** Model, stop reason and every token count of the span, when it has them. */
const TraceMetrics = ({ span }: { span: TraceSpan }) => {
  const usage = span.usage;
  const items: { label: string; value: string; title?: string }[] = [];
  if (span.model) items.push({ label: 'Model', value: span.model, title: span.model });
  if (span.stopReason) items.push({ label: 'Stop reason', value: span.stopReason, title: span.stopReason });
  if (usage) {
    const tokens: [string, number][] = [
      ['Context', usage.context],
      ['Input', usage.input],
      ['Cache read', usage.cacheRead],
      ['Cache write', usage.cacheWrite],
      ['Output', usage.output],
      ['Reasoning', usage.reasoning],
    ];
    for (const [label, value] of tokens) items.push({ label, value: formatTokens(value), title: `${value.toLocaleString()} tokens` });
  }
  if (items.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3 lg:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className={cn('min-w-0 bg-surface px-4 py-2.5', (item.label === 'Model' || item.label === 'Stop reason') && 'max-sm:col-span-2 lg:col-span-2')}>
          <dt className="text-[11px] font-medium text-ink-subtle">{item.label}</dt>
          <dd className="mt-0.5 truncate font-mono text-[13px] text-ink tabular-nums" title={item.title}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
};

interface TraceInspectorSheetProps {
  scroller: RefObject<HTMLDivElement | null>;
  header: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

/**
 * The phone bottom sheet (portal): backdrop tap or swipe down closes, swipe left / right changes span.
 * The sheet scrolls vertically itself (`touch-action: pan-y`, D10), its header takes every gesture.
 */
const TraceInspectorSheet = ({ scroller, header, children, onClose, onNext, onPrevious }: TraceInspectorSheetProps) => {
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ axis: SwipeAxis; offset: number } | null>(null);
  useLockBodyScroll(true);

  useSwipeGestures(sheet, {
    onSwipeDown: onClose,
    onSwipeLeft: onNext,
    onSwipeRight: onPrevious,
    onDrag: (axis, offset) => setDrag({ axis, offset }),
    onDragEnd: () => setDrag(null),
    canSwipeDown: () => (scroller.current?.scrollTop ?? 0) <= 0,
  });

  // The sheet takes focus (screen readers land in it); the trigger gets it back on close.
  useEffect(() => {
    if (!sheet) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.focus({ preventScroll: true });
    return () => trigger?.focus({ preventScroll: true });
  }, [sheet]);

  const style: CSSProperties | undefined = drag
    ? { transform: drag.axis === 'y' ? `translateY(${drag.offset}px)` : `translateX(${drag.offset * SIDE_DRAG}px)` }
    : undefined;

  return createPortal(
    <div className="fixed inset-x-0 top-(--app-offset) z-50 flex h-app flex-col justify-end">
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[3px]" onClick={onClose} />
      <div
        ref={setSheet}
        role="dialog"
        aria-modal="true"
        aria-label="Step inspector"
        tabIndex={-1}
        style={style}
        className={cn(
          'relative flex max-h-[85%] min-h-[40%] w-full animate-sheet-in touch-pan-y flex-col overflow-hidden rounded-t-[22px] border-t border-line bg-surface text-ink shadow-pop outline-none',
          !drag && 'transition-transform duration-200 ease-out',
        )}
      >
        <div className="relative shrink-0 touch-none border-b border-line px-4 pt-5 pb-3 select-none">
          <span aria-hidden className="absolute top-2 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-line-strong" />
          {header}
        </div>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-(--safe-bottom)">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
