import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import type { TodoSyncStatus } from '@/features/todos/types/TodoSyncStatus';
import { cn } from '@/shared/utils/cn';

interface TodoSyncIndicatorProps {
  status: TodoSyncStatus;
  branch: string;
}

/** Says where the list stands against the repository, in the words of a commit. */
export const TodoSyncIndicator = ({ status, branch }: TodoSyncIndicatorProps) => {
  const { icon: Icon, label, tone } = {
    saving: { icon: LoaderCircle, label: `Committing to ${branch}…`, tone: 'text-ink-muted' },
    failed: { icon: CircleAlert, label: 'Not committed', tone: 'text-danger' },
    idle: { icon: CircleCheck, label: `In sync with ${branch}`, tone: 'text-ink-subtle' },
  }[status];

  return (
    <span role="status" aria-live="polite" className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold', tone)}>
      <Icon className={cn('size-3.5 shrink-0', status === 'saving' && 'animate-spin', status === 'idle' && 'text-success-dot')} />
      <span className="truncate">{label}</span>
    </span>
  );
};
