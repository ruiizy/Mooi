import type { TodoCounts } from '@/features/todos/lib/countTodos';
import type { TodoFilter } from '@/features/todos/types/TodoFilter';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

interface TodoFiltersProps {
  value: TodoFilter;
  counts: TodoCounts;
  onChange: (filter: TodoFilter) => void;
}

const FILTERS: { id: TodoFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'inProgress', label: 'In progress' },
  { id: 'open', label: 'To do' },
  { id: 'done', label: 'Done' },
];

/**
 * The status filters, each with its count in a pill that keeps its size whatever the number. Four
 * equal columns span a phone, label over count; from `sm` they sit inline, label beside count.
 */
export const TodoFilters = ({ value, counts, onChange }: TodoFiltersProps) => {
  const total = counts.open + counts.inProgress + counts.done;

  return (
    <div
      role="group"
      aria-label="Filter to-dos"
      className="grid w-full shrink-0 grid-cols-4 gap-0.5 rounded-control border border-line bg-surface-2 p-0.5 sm:inline-grid sm:w-auto sm:auto-cols-max sm:grid-flow-col sm:grid-cols-none"
    >
      {FILTERS.map(({ id, label }) => {
        const count = id === 'all' ? total : counts[id];
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            aria-label={`${label}, ${count}`}
            title={count >= 1000 ? `${label}: ${count.toLocaleString('en')}` : undefined}
            onClick={() => onChange(id)}
            className={cn(
              'flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[7px] px-1 py-1 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9 sm:flex-row sm:gap-1.5 sm:px-2.5 sm:py-0 sm:text-[13px]',
              active ? 'bg-surface text-ink shadow-raised ring-1 ring-line' : 'text-ink-muted hover:text-ink',
            )}
          >
            <span className="max-w-full truncate">{label}</span>
            <span
              aria-hidden
              className={cn(
                'min-w-5 rounded-full px-1.5 py-px text-center font-mono text-[10.5px] leading-4 font-medium tabular-nums whitespace-nowrap transition-colors',
                active ? 'bg-contrast text-contrast-ink' : 'bg-surface-3 text-ink-muted',
              )}
            >
              {formatCount(count)}
            </span>
          </button>
        );
      })}
    </div>
  );
};
