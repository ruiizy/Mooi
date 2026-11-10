import type { SegmentItem } from '@/shared/types/SegmentItem';
import { cn } from '@/shared/utils/cn';

interface SegmentedControlProps {
  items: SegmentItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /** Id of the element naming the group. */
  labelledBy?: string;
}

export const SegmentedControl = ({ items, value, onChange, className, labelledBy }: SegmentedControlProps) => (
  <div role="group" aria-labelledby={labelledBy} className={cn('inline-flex flex-wrap gap-1 rounded-control border border-line bg-surface-2 p-0.5', className)}>
    {items.map((item) => {
      const Icon = item.icon;
      const isActive = item.id === value;

      return (
        <button
          key={item.id}
          type="button"
          aria-pressed={isActive}
          onClick={() => onChange(item.id)}
          className={cn(
            'inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            isActive ? 'bg-surface text-ink shadow-raised ring-1 ring-line' : 'text-ink-muted hover:text-ink',
          )}
        >
          {Icon ? <Icon className="size-4" /> : null}
          {item.label}
        </button>
      );
    })}
  </div>
);
