import { useMemo, useState } from 'react';
import { CircleCheckBig, ListTodo } from 'lucide-react';
import { TodoComposer } from '@/features/todos/components/TodoComposer';
import { TodoFilters } from '@/features/todos/components/TodoFilters';
import { TodoProgressBar } from '@/features/todos/components/TodoProgressBar';
import { TodoSortableList } from '@/features/todos/components/TodoSortableList';
import { TodosCleanupDialog } from '@/features/todos/components/TodosCleanupDialog';
import { TodosUnsupported } from '@/features/todos/components/TodosUnsupported';
import type { UseProjectTodos } from '@/features/todos/hooks/useProjectTodos';
import { countTodos } from '@/features/todos/lib/countTodos';
import { keptTodosRevision } from '@/features/todos/lib/keptTodosRevision';
import type { TodoFilter } from '@/features/todos/types/TodoFilter';
import type { TodoList } from '@/features/todos/types/TodoList';
import { Card } from '@/shared/components/Card';
import { cn } from '@/shared/utils/cn';

const emptyFilter: Record<TodoFilter, string> = {
  all: 'All clear',
  open: 'Everything is started',
  inProgress: 'Nothing in progress',
  done: 'Nothing completed yet',
};

interface TodoListEditorProps extends Pick<UseProjectTodos, 'items' | 'saveError' | 'status' | 'change'> {
  projectId: string;
  branch: string;
  list: TodoList;
  /**
   * Standalone (a project's tab): a card with the list's title and progress. Embedded (a project's
   * row on the To-dos page): just the editing surface, under a header that already shows both.
   */
  framed?: boolean;
}

/** One project's list, editable: filters, composer, the sortable items, and the unsupported-file flow. */
export const TodoListEditor = ({ projectId, branch, list, items, saveError, status, change, framed = true }: TodoListEditorProps) => {
  const [filter, setFilter] = useState<TodoFilter>('all');
  const [cleaning, setCleaning] = useState(false);
  const [keptRevision, setKeptRevision] = useState(() => keptTodosRevision.read(projectId));

  const counts = useMemo(() => countTodos(items), [items]);
  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.status === filter)),
    [items, filter],
  );
  const texts = useMemo(() => items.map((item) => item.text), [items]);

  const keep = () => {
    keptTodosRevision.write(projectId, list.revision);
    setKeptRevision(list.revision);
  };

  const cleanUp = () => {
    setCleaning(false);
    keptTodosRevision.write(projectId, null);
    setKeptRevision(null);
    change({ kind: 'replace', items: list.salvage });
  };

  // A stable element type per variant: a render never remounts the composer or the list below it.
  const Shell = framed ? Card : 'div';

  return (
    <>
      {saveError ? (
        <p role="alert" className={cn('rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger', !framed && 'mx-3 sm:mx-5')}>
          {saveError} The list shows the latest version from GitHub.
        </p>
      ) : null}

      {list.state === 'unsupported' && status !== 'saving' ? (
        <TodosUnsupported list={list} kept={keptRevision === list.revision}
          onCleanUp={() => setCleaning(true)} onKeep={keep} />
      ) : (
        <Shell className="overflow-hidden">
          <div className={cn('flex flex-col gap-4', framed ? 'p-4 sm:p-5' : 'px-3 pt-1 pb-4 sm:px-5')}>
            {framed || items.length > 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                {framed ? (
                  <div className="min-w-0">
                    <h2 className="truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">{list.title}</h2>
                    <p className="mt-0.5 text-[13px] text-ink-muted">
                      {items.length === 0 ? 'Nothing planned yet' : `${counts.done} of ${items.length} done`}
                      {counts.inProgress > 0 ? ` · ${counts.inProgress} in progress` : null}
                    </p>
                  </div>
                ) : null}
                {items.length > 0 ? <TodoFilters value={filter} counts={counts} onChange={setFilter} /> : null}
              </div>
            ) : null}
            {framed && items.length > 0 ? <TodoProgressBar counts={counts} /> : null}
            <TodoComposer existing={texts} disabled={list.state === 'unsupported'}
              onAdd={(text) => change({ kind: 'add', text })} />
          </div>

          {visible.length > 0 ? (
            <TodoSortableList items={visible} texts={texts} locked={list.state === 'unsupported'} change={change} />
          ) : (
            <div className={cn('flex flex-col items-center border-t border-line px-6 text-center', framed ? 'py-10' : 'py-8')}>
              <span className={cn('flex size-10 items-center justify-center rounded-xl border border-line bg-surface shadow-raised',
                items.length > 0 ? 'text-success-dot' : 'text-ink-muted')}>
                {items.length > 0 ? <CircleCheckBig className="size-5" /> : <ListTodo className="size-5" />}
              </span>
              <p className="mt-3 text-sm font-semibold text-ink">
                {items.length === 0 ? (list.state === 'missing' ? 'Start the project’s to-do list' : 'All clear')
                  : emptyFilter[filter]}
              </p>
              <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-ink-muted">
                {list.state === 'missing'
                  ? `Add a first item: Mooi creates ${list.path} on ${branch} and commits every change you make.`
                  : 'Items you add here are committed to the repository, and agents can manage them from any session chat.'}
              </p>
            </div>
          )}
        </Shell>
      )}

      {cleaning ? (
        <TodosCleanupDialog list={list} branch={branch} onClose={() => setCleaning(false)} onConfirm={cleanUp} />
      ) : null}
    </>
  );
};
