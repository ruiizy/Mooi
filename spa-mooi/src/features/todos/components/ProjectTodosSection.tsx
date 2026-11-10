import { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronRight, ExternalLink, RefreshCw } from 'lucide-react';
import { projectPath } from '@/app/paths';
import type { Project } from '@/features/projects/types/Project';
import { TodoListEditor } from '@/features/todos/components/TodoListEditor';
import { TodoProgressBar } from '@/features/todos/components/TodoProgressBar';
import { TodoSyncIndicator } from '@/features/todos/components/TodoSyncIndicator';
import { useProjectTodos } from '@/features/todos/hooks/useProjectTodos';
import { countTodos } from '@/features/todos/lib/countTodos';
import { Card } from '@/shared/components/Card';
import { Initials } from '@/shared/components/Initials';
import { useSeenOnce } from '@/shared/hooks/useSeenOnce';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

interface ProjectTodosSectionProps {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
}

const headerAction =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-control text-ink-subtle transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60';

/**
 * One project on the To-dos page: a header with its progress, expanding into the same editor as
 * the project's own tab. Its list is read from GitHub only once the row nears the screen, so the
 * page opens at once however many projects the workspace holds; commits then stream in live.
 */
export const ProjectTodosSection = ({ project, expanded, onToggle }: ProjectTodosSectionProps) => {
  const { ref, seen } = useSeenOnce<HTMLDivElement>();
  const todos = useProjectTodos(project.id, seen || expanded);
  const { list, items, loadError, status, reload } = todos;
  const counts = useMemo(() => countTodos(items), [items]);
  const bodyId = useId();
  const branch = project.defaultBranch ?? 'the default branch';

  const summary = !list
    ? (loadError ? { text: loadError, tone: 'text-danger' } : { text: 'Loading…', tone: 'text-ink-subtle' })
    : status === 'failed' ? { text: 'Last change not committed', tone: 'text-danger' }
      : list.state === 'unsupported' ? { text: 'Not in the Mooi format: open to clean it up', tone: 'text-warning' }
        : items.length === 0 ? { text: list.state === 'missing' ? 'No to-do list yet' : 'Nothing planned', tone: 'text-ink-subtle' }
          : {
            text: `${formatCount(counts.done)} of ${formatCount(items.length)} done${counts.inProgress > 0 ? ` · ${formatCount(counts.inProgress)} in progress` : ''}`,
            tone: 'text-ink-muted',
          };
  const remaining = counts.open + counts.inProgress;

  return (
    <Card as="li" className={cn('overflow-hidden transition-shadow', expanded && 'shadow-raised')}>
      <div ref={ref} className="flex items-center gap-1 py-2 pr-2 pl-2 sm:gap-2 sm:pr-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="group/head flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-control px-1.5 py-1 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:gap-3"
        >
          <ChevronRight className={cn('size-4 shrink-0 text-ink-subtle transition-transform duration-200 ease-out-expo group-hover/head:text-ink', expanded && 'rotate-90')} />
          <Initials value={project.name} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{project.name}</span>
            <span className={cn('truncate text-[12px] font-medium', summary.tone)}>{summary.text}</span>
          </span>
          {list && items.length > 0 ? (
            <span className="hidden w-28 shrink-0 flex-col gap-1.5 md:flex">
              <span className="text-right font-mono text-[10.5px] font-medium text-ink-subtle tabular-nums">
                {Math.round((counts.done / items.length) * 100)}%
              </span>
              <TodoProgressBar counts={counts} />
            </span>
          ) : null}
          {remaining > 0 ? (
            <span
              title={`${remaining.toLocaleString('en')} left to do`}
              className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[11px] font-medium text-ink-muted tabular-nums"
            >
              <span className="sr-only">Left to do: </span>
              {formatCount(remaining)}
            </span>
          ) : null}
        </button>
        <Link to={`${projectPath(project.id)}?tab=todos`} aria-label={`Open ${project.name}`} title="Open project" className={headerAction}>
          <ArrowUpRight className="size-4" />
        </Link>
      </div>

      {list && items.length > 0 && !expanded ? <TodoProgressBar counts={counts} className="mx-4 mb-3 md:hidden" /> : null}

      {expanded ? (
        <div id={bodyId} className="flex animate-fade-in flex-col gap-3 border-t border-line pt-3">
          {!list ? (
            loadError ? (
              <div className="flex items-center justify-between gap-3 px-4 pb-4 text-[13px] text-danger sm:px-5">
                <span>{loadError}</span>
                <button type="button" onClick={reload} className="font-semibold underline-offset-2 hover:underline">Retry</button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
                <div className="h-11 animate-pulse-soft rounded-control bg-surface-2" />
                {[0, 1].map((index) => <div key={index} className="h-9 animate-pulse-soft rounded bg-surface-2" />)}
              </div>
            )
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 sm:px-5">
                <p className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[11px] text-ink-subtle">
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
                <span className="hidden sm:inline-flex"><TodoSyncIndicator status={status} branch={branch} /></span>
                <button type="button" onClick={reload} disabled={status === 'saving'} aria-label={`Reload ${project.name} to-dos from GitHub`}
                  title="Reload from GitHub" className={cn(headerAction, 'size-8')}>
                  <RefreshCw className={cn('size-3.5', status === 'saving' && 'animate-spin')} />
                </button>
              </div>
              <div className={cn('flex flex-col gap-3', list.state === 'unsupported' && 'px-3 pb-3 sm:px-4 sm:pb-4')}>
                <TodoListEditor projectId={project.id} branch={branch} list={list} items={items}
                  saveError={todos.saveError} status={status} change={todos.change} framed={false} />
              </div>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
};
