import { ExternalLink, ListTodo, RefreshCw } from 'lucide-react';
import { TodoListEditor } from '@/features/todos/components/TodoListEditor';
import { TodoSyncIndicator } from '@/features/todos/components/TodoSyncIndicator';
import { useProjectTodos } from '@/features/todos/hooks/useProjectTodos';
import { Card } from '@/shared/components/Card';
import { EmptyState } from '@/shared/components/EmptyState';
import { Eyebrow } from '@/shared/components/Eyebrow';

interface TodosPanelProps {
  projectId: string;
  branch: string;
}

/**
 * The project's to-do list, a view over `docs/TODOS.md` on the default branch: every change is a
 * commit there, and changes made anywhere else (another device, an agent) show up live. Mounted
 * only while its tab is open, so the GitHub read happens when the list is actually looked at.
 */
export const TodosPanel = ({ projectId, branch }: TodosPanelProps) => {
  const { list, items, loadError, saveError, status, change, reload } = useProjectTodos(projectId);

  if (!list) {
    if (loadError) {
      return <EmptyState icon={ListTodo} title="To-do list unavailable" description={loadError} />;
    }
    return (
      <Card className="flex flex-col gap-3 p-5">
        <div className="h-5 w-40 animate-pulse-soft rounded bg-surface-2" />
        <div className="h-11 animate-pulse-soft rounded-control bg-surface-2" />
        {[0, 1, 2].map((index) => <div key={index} className="h-9 animate-pulse-soft rounded bg-surface-2" />)}
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Eyebrow>Kept in the repository</Eyebrow>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-ink-subtle">
            {list.htmlUrl && list.state !== 'missing' ? (
              <a href={list.htmlUrl} target="_blank" rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 rounded transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                <span className="truncate">{list.path}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : <span className="truncate">{list.path}</span>}
            <span aria-hidden>·</span>
            <span className="truncate">{branch}</span>
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <TodoSyncIndicator status={status} branch={branch} />
          <button
            type="button"
            onClick={reload}
            disabled={status === 'saving'}
            aria-label="Reload from GitHub"
            title="Reload from GitHub"
            className="inline-flex size-8 items-center justify-center rounded-control border border-line text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      <TodoListEditor projectId={projectId} branch={branch} list={list} items={items}
        saveError={saveError} status={status} change={change} />
    </section>
  );
};
