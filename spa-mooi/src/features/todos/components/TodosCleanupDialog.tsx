import { Check, Circle, CircleDot } from 'lucide-react';
import type { TodoList } from '@/features/todos/types/TodoList';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { cn } from '@/shared/utils/cn';

interface TodosCleanupDialogProps {
  list: TodoList;
  branch: string;
  onClose: () => void;
  onConfirm: () => void;
}

/** Shows exactly what the rewrite keeps before anything is committed. */
export const TodosCleanupDialog = ({ list, branch, onClose, onConfirm }: TodosCleanupDialogProps) => (
  <Modal
    open
    onClose={onClose}
    title={`Clean up ${list.path}?`}
    description={`Mooi rewrites the file as a plain task list and commits it to ${branch}. Anything that is not a task is removed from the file; it stays in the Git history.`}
    footer={(
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="brand" onClick={onConfirm}>Clean up and commit</Button>
      </>
    )}
  >
    <p className="text-[13px] font-semibold text-ink">
      {list.salvage.length === 0 ? 'No task could be recovered: the list starts empty.'
        : `${list.salvage.length} ${list.salvage.length === 1 ? 'task is' : 'tasks are'} kept, in order:`}
    </p>
    {list.salvage.length > 0 ? (
      <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-control border border-line">
        {list.salvage.map((item, index) => (
          <li key={`${index}:${item.text}`} className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
            {item.status === 'done' ? <Check className="mt-0.5 size-3.5 shrink-0 text-success-dot" strokeWidth={3} />
              : item.status === 'inProgress' ? <CircleDot className="mt-0.5 size-3.5 shrink-0 text-info-dot" />
                : <Circle className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" />}
            <span className={cn('[overflow-wrap:anywhere]', item.status === 'done' ? 'text-ink-subtle line-through' : 'text-ink')}>{item.text}</span>
          </li>
        ))}
      </ul>
    ) : null}
    <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
      <code className="font-mono">[x]</code> stays done and <code className="font-mono">[/]</code> stays in progress; other
      markers (such as <code className="font-mono">[*]</code>) become open tasks.
    </p>
  </Modal>
);
