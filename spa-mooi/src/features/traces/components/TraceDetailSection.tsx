import { useId, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { prettyTraceText } from '@/features/traces/lib/prettyTraceText';
import { CopyButton } from '@/shared/components/CopyButton';
import { cn } from '@/shared/utils/cn';

interface TraceDetailSectionProps {
  title: string;
  /** The section's text; `null` shows `emptyLabel` (or a skeleton while `loading`). */
  value: string | null;
  loading?: boolean;
  emptyLabel?: string;
  defaultOpen?: boolean;
}

/**
 * One collapsible block of the inspector (Input, Output, Metadata): a header with the size and a copy
 * button, then the text in monospace, JSON pretty-printed, wrapped (never wider than the pane) and
 * scrolled inside a bounded height so a huge payload never pushes the next sections away.
 */
export const TraceDetailSection = ({ title, value, loading = false, emptyLabel = 'Nothing recorded', defaultOpen = true }: TraceDetailSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const text = useMemo(() => (value ? prettyTraceText(value) : null), [value]);

  return (
    <section className="min-w-0 border-t border-line">
      <div className="flex min-h-11 items-center gap-1 pr-2 pl-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-control px-2 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        >
          <ChevronRight className={cn('size-3.5 shrink-0 text-ink-subtle transition-transform duration-150', open && 'rotate-90')} />
          <span className="text-[12px] font-semibold tracking-wide text-ink uppercase">{title}</span>
          {text ? <span className="truncate font-mono text-[11px] text-ink-subtle tabular-nums">{text.length.toLocaleString()} chars</span> : null}
        </button>
        {text ? <CopyButton value={text} label={`Copy ${title.toLowerCase()}`} /> : null}
      </div>
      {open ? (
        <div id={bodyId} className="px-3 pb-3">
          {text ? (
            <pre className="max-h-[22rem] overflow-auto overscroll-contain rounded-control border border-line bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-ink">
              {text}
            </pre>
          ) : loading ? (
            <div aria-label={`Loading ${title.toLowerCase()}`} className="h-16 animate-pulse-soft rounded-control bg-surface-2" />
          ) : (
            <p className="rounded-control border border-dashed border-line px-3 py-2.5 text-[12px] text-ink-subtle">{emptyLabel}</p>
          )}
        </div>
      ) : null}
    </section>
  );
};
