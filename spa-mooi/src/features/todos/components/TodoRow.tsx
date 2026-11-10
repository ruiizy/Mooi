import { useState, type KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { TodoTextArea } from '@/features/todos/components/TodoTextArea';
import { normalizeTodoText } from '@/features/todos/lib/normalizeTodoText';
import type { TodoItem } from '@/features/todos/types/TodoItem';
import type { TodoStatus } from '@/features/todos/types/TodoStatus';
import { Badge } from '@/shared/components/Badge';
import { cn } from '@/shared/utils/cn';

interface TodoRowProps {
  /** Stable sortable id, unique even when a hand-written file repeats a text. */
  id: string;
  item: TodoItem;
  /** Texts of the other items, so an edit cannot turn one item into a copy of another. */
  taken: (text: string) => boolean;
  /** Reordering is off while the list cannot be saved. */
  locked: boolean;
  onStatus: (status: TodoStatus) => void;
  onEdit: (next: string) => void;
  onRemove: () => void;
}

const rowAction =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-ink-subtle transition hover:bg-surface-3 hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** Shown on hover with a pointer, always visible on touch screens, where nothing hovers. */
const revealOnHover =
  'opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/todo:opacity-100 [@media(hover:hover)]:group-hover/todo:opacity-100';

const checkLabel: Record<TodoStatus, string> = { open: 'Complete', inProgress: 'Complete', done: 'Reopen' };

/**
 * One item. The circle completes or reopens it and reads as a checkbox (`mixed` while in progress);
 * the play/pause action starts or stops it; the grip drags it, with a pointer, a finger or the
 * keyboard (Space, arrows, Space).
 */
export const TodoRow = ({ id, item, taken, locked, onStatus, onEdit, onRemove }: TodoRowProps) => {
  const [draft, setDraft] = useState<string | null>(null);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: locked || draft !== null });
  const { status } = item;

  const commit = () => {
    if (draft === null) return;
    const next = normalizeTodoText(draft);
    setDraft(null);
    if (next && next !== item.text && !taken(next)) onEdit(next);
  };

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') setDraft(null);
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/todo relative flex min-h-12 animate-fade-in items-start gap-1 bg-surface py-1.5 pr-3 pl-1 transition-colors hover:bg-surface-2/60 sm:pr-4 sm:pl-1.5',
        isDragging && 'z-10 rounded-control bg-surface shadow-raised ring-1 ring-line hover:bg-surface',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={locked || draft !== null}
        aria-label={`Reorder “${item.text}”`}
        title="Drag to reorder"
        className={cn(
          'mt-1.5 flex h-8 w-5 shrink-0 touch-none items-center justify-center rounded-md text-ink-subtle hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:invisible',
          isDragging ? 'cursor-grabbing opacity-100' : cn('cursor-grab', revealOnHover),
        )}
      >
        <GripVertical className="size-4" />
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={status === 'done' ? true : status === 'inProgress' ? 'mixed' : false}
        aria-label={`${checkLabel[status]} “${item.text}”`}
        onClick={() => onStatus(status === 'done' ? 'open' : 'done')}
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
      >
        <span
          className={cn(
            'flex size-[18px] items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-200 ease-out-expo active:scale-90',
            status === 'done' && 'border-success-dot bg-success-dot text-white',
            status === 'inProgress' && 'border-info-dot bg-surface',
            status === 'open' && 'border-line-strong bg-surface group-hover/todo:border-ink-subtle',
          )}
        >
          {status === 'inProgress' ? (
            <span className="size-2 rounded-full bg-[conic-gradient(var(--color-info-dot)_50%,transparent_0)]" />
          ) : (
            <Check strokeWidth={3} className={cn('size-3 transition-[opacity,transform] duration-200', status === 'done' ? 'scale-100 opacity-100' : 'scale-50 opacity-0')} />
          )}
        </span>
      </button>

      {draft !== null ? (
        <TodoTextArea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.setSelectionRange(draft.length, draft.length)}
          onBlur={commit}
          onSubmit={commit}
          onKeyDown={handleKey}
          aria-label="Edit to-do"
          className="my-0.5 ml-2 min-h-9 min-w-0 flex-1 rounded-md border border-brand/60 bg-surface px-2 py-[7px] text-sm leading-5 font-medium text-ink ring-4 ring-brand/12 focus:outline-none"
        />
      ) : (
        <p
          onDoubleClick={() => setDraft(item.text)}
          className={cn(
            'ml-2 min-w-0 flex-1 py-2.5 text-sm leading-5 [overflow-wrap:anywhere] transition-colors duration-200',
            status === 'done' ? 'text-ink-subtle line-through decoration-line-strong' : 'font-medium text-ink',
          )}
        >
          {item.text}
          {status === 'inProgress' ? <Badge tone="info" className="ml-2 align-[1px]">In progress</Badge> : null}
        </p>
      )}

      {draft === null ? (
        <div className={cn('mt-0.5 flex shrink-0 items-center gap-0.5', revealOnHover)}>
          {status === 'inProgress' ? (
            <button type="button" onClick={() => onStatus('open')} aria-label={`Stop “${item.text}”`} title="Mark as not started" className={rowAction}>
              <Pause className="size-3.5" />
            </button>
          ) : (
            <button type="button" onClick={() => onStatus('inProgress')} aria-label={`Start “${item.text}”`} title="Mark in progress" className={rowAction}>
              <Play className="size-3.5" />
            </button>
          )}
          <button type="button" onClick={() => setDraft(item.text)} aria-label={`Edit “${item.text}”`} title="Edit" className={rowAction}>
            <Pencil className="size-3.5" />
          </button>
          <button type="button" onClick={onRemove} aria-label={`Remove “${item.text}”`} title="Remove"
            className={cn(rowAction, 'hover:bg-danger-soft hover:text-danger')}>
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ) : null}
    </li>
  );
};
