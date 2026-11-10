import type { TodoCounts } from '@/features/todos/lib/countTodos';
import { cn } from '@/shared/utils/cn';

interface TodoProgressBarProps {
  counts: TodoCounts;
  className?: string;
}

/** Done, then in progress, over what is left: the list's progress at a glance. */
export const TodoProgressBar = ({ counts, className }: TodoProgressBarProps) => {
  const total = counts.open + counts.inProgress + counts.done;
  const share = (count: number) => (total === 0 ? 0 : (count / total) * 100);

  return (
    <div aria-hidden className={cn('flex h-1 overflow-hidden rounded-full bg-surface-3', className)}>
      <div className="h-full bg-success-dot transition-[width] duration-500 ease-out-expo" style={{ width: `${share(counts.done)}%` }} />
      <div className="h-full bg-info-dot/60 transition-[width] duration-500 ease-out-expo" style={{ width: `${share(counts.inProgress)}%` }} />
    </div>
  );
};
