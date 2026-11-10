import { lazy, Suspense } from 'react';
import { ExternalLink, FileWarning, Sparkles } from 'lucide-react';
import type { TodoList } from '@/features/todos/types/TodoList';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { buttonStyles } from '@/shared/styles/buttonStyles';

const MarkdownContent = lazy(() => import('@/features/sessions/components/chat/MarkdownContent'));
const SHOWN_ISSUES = 5;

interface TodosUnsupportedProps {
  list: TodoList;
  /** The player chose to keep the file as it is: show it read-only instead of asking again. */
  kept: boolean;
  onCleanUp: () => void;
  onKeep: () => void;
}

const GithubLink = ({ list, label }: { list: TodoList; label: string }) => (list.htmlUrl ? (
  <a href={list.htmlUrl} target="_blank" rel="noreferrer" className={buttonStyles('secondary', 'md')}>
    <ExternalLink className="size-4" />
    {label}
  </a>
) : null);

/**
 * A file Mooi cannot render without losing something. Mooi never edits it on its own: the player
 * either cleans it up into the Mooi format or keeps managing it by hand.
 */
export const TodosUnsupported = ({ list, kept, onCleanUp, onKeep }: TodosUnsupportedProps) => {
  if (kept) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line bg-surface-2/60 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Managed by hand.</span> Mooi shows this file read-only because it does not match the to-do format.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={onCleanUp}>
              <Sparkles className="size-4" />
              Clean up
            </Button>
            <GithubLink list={list} label="Edit on GitHub" />
          </div>
        </div>
        <div className="px-4 py-5 text-sm leading-relaxed text-ink sm:px-6">
          <Suspense fallback={<div className="h-24 animate-pulse-soft rounded-control bg-surface-2" />}>
            <MarkdownContent text={list.content ?? ''} />
          </Suspense>
        </div>
      </Card>
    );
  }

  const hidden = list.issues.length - SHOWN_ISSUES;

  return (
    <Card className="flex animate-fade-up flex-col gap-5 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
          <FileWarning className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-[-0.015em] text-ink">This to-do list can't be rendered by Mooi</h3>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
            <code className="font-mono text-[12px] text-ink">{list.path}</code> already exists, but some of its content
            does not match the format Mooi edits: a title and plain task items (<code className="font-mono">- [ ]</code>,{' '}
            <code className="font-mono">- [/]</code> or <code className="font-mono">- [x]</code>). Mooi will not change it unless you ask to.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-control border border-line">
        <p className="border-b border-line bg-surface-2/60 px-3 py-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">
          {list.issues.length} {list.issues.length === 1 ? 'line' : 'lines'} not understood
        </p>
        <ul className="divide-y divide-line font-mono text-[12px]">
          {list.issues.slice(0, SHOWN_ISSUES).map((issue) => (
            <li key={issue.line} className="flex gap-3 px-3 py-1.5">
              <span className="w-8 shrink-0 text-right text-ink-subtle tabular-nums">{issue.line}</span>
              <span className="min-w-0 truncate text-ink">{issue.text}</span>
            </li>
          ))}
        </ul>
        {hidden > 0 ? <p className="border-t border-line px-3 py-1.5 text-[12px] text-ink-subtle">and {hidden} more</p> : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="brand" onClick={onCleanUp}>
          <Sparkles className="size-4" />
          Clean up for Mooi
        </Button>
        <Button variant="secondary" onClick={onKeep}>Keep it and manage it myself</Button>
      </div>
    </Card>
  );
};
