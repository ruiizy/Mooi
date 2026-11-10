import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { TodoTextArea } from '@/features/todos/components/TodoTextArea';
import { normalizeTodoText } from '@/features/todos/lib/normalizeTodoText';
import { Button } from '@/shared/components/Button';
import { cn } from '@/shared/utils/cn';

interface TodoComposerProps {
  /** Texts already on the list: an item is addressed by its text, so each one appears once. */
  existing: string[];
  disabled: boolean;
  onAdd: (text: string) => void;
}

export const TodoComposer = ({ existing, disabled, onAdd }: TodoComposerProps) => {
  const [value, setValue] = useState('');
  const text = normalizeTodoText(value);
  const duplicate = text.length > 0 && existing.includes(text);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!text || duplicate || disabled) return;
    onAdd(text);
    setValue('');
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <label
          className={cn(
            'flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-control border border-line bg-surface px-3 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus-within:border-brand/60 focus-within:ring-4 focus-within:ring-brand/12',
            duplicate && 'border-warning/60 focus-within:border-warning/60 focus-within:ring-warning/12',
          )}
        >
          <Plus className="mt-3.5 size-4 shrink-0 text-ink-subtle" />
          <TodoTextArea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onSubmit={submit}
            disabled={disabled}
            enterKeyHint="done"
            placeholder="Add a to-do…"
            aria-label="New to-do"
            className="max-h-60 w-full min-w-0 bg-transparent py-[11px] text-sm leading-5 font-medium text-ink placeholder:text-ink-subtle focus:outline-none disabled:cursor-not-allowed"
          />
        </label>
        <Button type="submit" size="md" disabled={disabled || !text || duplicate} className="h-11">
          Add
        </Button>
      </div>
      {duplicate ? <p className="px-1 text-[12px] font-semibold text-warning">Already on the list.</p> : null}
    </form>
  );
};
