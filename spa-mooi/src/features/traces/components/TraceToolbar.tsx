import { ChevronsDownUp, ChevronsUpDown, CircleAlert } from 'lucide-react';
import { traceKindStyle } from '@/features/traces/lib/traceKindStyle';
import type { TraceFilter } from '@/features/traces/types/TraceFilter';
import type { TraceSpanKind } from '@/features/traces/types/TraceSpanKind';
import { IconButton } from '@/shared/components/IconButton';
import { SearchInput } from '@/shared/components/SearchInput';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

interface TraceToolbarProps {
  filter: TraceFilter;
  onFilterChange: (filter: TraceFilter) => void;
  /** Spans per kind (`summary.counts`). */
  counts: Record<TraceSpanKind, number>;
  errors: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

/** Kind chips (FR4); prompts and turns are always shown as the parents of what matches. */
const CHIPS: { id: string; label: string; kinds: TraceSpanKind[] }[] = [
  { id: 'llm', label: 'LLM', kinds: ['llm'] },
  { id: 'tool', label: 'Tools', kinds: ['tool'] },
  { id: 'agent', label: 'Sub-agents', kinds: ['agent'] },
  { id: 'skill', label: 'Skills', kinds: ['skill'] },
  { id: 'hook', label: 'Hooks', kinds: ['hook'] },
  { id: 'context', label: 'Context', kinds: ['context'] },
  { id: 'event', label: 'Events', kinds: ['event', 'compaction'] },
];

const chipClass = (active: boolean) =>
  cn(
    'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium whitespace-nowrap transition-[background-color,border-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    active ? 'border-line-strong bg-surface text-ink shadow-raised' : 'border-line bg-surface-2/60 text-ink-muted hover:text-ink',
  );

const countClass = (active: boolean) =>
  cn(
    'min-w-5 rounded-full px-1.5 py-px text-center font-mono text-[10.5px] leading-4 tabular-nums',
    active ? 'bg-contrast text-contrast-ink' : 'bg-surface-3 text-ink-muted',
  );

/**
 * Search, kind chips with counts, the errors toggle and expand / collapse all. The chips scroll
 * sideways on phones instead of wrapping, so the toolbar keeps one compact height.
 */
export const TraceToolbar = ({ filter, onFilterChange, counts, errors, onExpandAll, onCollapseAll }: TraceToolbarProps) => {
  const toggle = (kinds: TraceSpanKind[]) => {
    const on = kinds.every((kind) => filter.kinds.includes(kind));
    onFilterChange({
      ...filter,
      kinds: on ? filter.kinds.filter((kind) => !kinds.includes(kind)) : [...filter.kinds, ...kinds.filter((kind) => !filter.kinds.includes(kind))],
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 px-3 py-2 sm:px-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 items-center gap-1 lg:w-72 lg:shrink-0">
        <SearchInput
          value={filter.query}
          onChange={(query) => onFilterChange({ ...filter, query })}
          placeholder="Search steps"
          className="h-10 min-w-0 flex-1"
        />
        <IconButton icon={ChevronsUpDown} label="Expand all" onClick={onExpandAll} className="lg:hidden" />
        <IconButton icon={ChevronsDownUp} label="Collapse all" onClick={onCollapseAll} className="lg:hidden" />
      </div>

      <div role="group" aria-label="Filter steps" className="scrollbar-none -mx-3 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-3 sm:-mx-4 sm:px-4 lg:mx-0 lg:px-0">
        {CHIPS.map((chip) => {
          const active = chip.kinds.every((kind) => filter.kinds.includes(kind));
          const count = chip.kinds.reduce((total, kind) => total + (counts[kind] ?? 0), 0);
          const Icon = traceKindStyle(chip.kinds[0]).icon;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={active}
              aria-label={`${chip.label}, ${count}`}
              title={`${chip.label}: ${count.toLocaleString('en')}`}
              onClick={() => toggle(chip.kinds)}
              className={chipClass(active)}
            >
              <Icon aria-hidden className={cn('size-3.5', traceKindStyle(chip.kinds[0]).text)} />
              {chip.label}
              <span aria-hidden className={countClass(active)}>{formatCount(count)}</span>
            </button>
          );
        })}
        <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-line" />
        <button
          type="button"
          aria-pressed={filter.errorsOnly}
          aria-label={`Errors only, ${errors}`}
          title={`Errors: ${errors.toLocaleString('en')}`}
          onClick={() => onFilterChange({ ...filter, errorsOnly: !filter.errorsOnly })}
          className={cn(chipClass(filter.errorsOnly), filter.errorsOnly && 'border-danger/40 bg-danger-soft text-danger')}
        >
          <CircleAlert aria-hidden className="size-3.5 text-danger" />
          Errors only
          <span aria-hidden className={cn(countClass(false), errors > 0 && 'bg-danger-soft text-danger')}>{formatCount(errors)}</span>
        </button>
      </div>

      <div className="hidden shrink-0 items-center lg:flex">
        <IconButton icon={ChevronsUpDown} label="Expand all" onClick={onExpandAll} />
        <IconButton icon={ChevronsDownUp} label="Collapse all" onClick={onCollapseAll} />
      </div>
    </div>
  );
};
