import { lazy, memo, Suspense, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ActivityStepRow } from './ActivityStepRow';
import { WorkingStatus } from './WorkingStatus';
import { describeStep, thinkingHeadline, thinkingIcon as ThinkingIcon } from '@/features/sessions/lib/describeStep';
import { blockKey, summarizeActivity } from '@/features/sessions/lib/groupTurnBlocks';
import type { ActivityBlock } from '@/features/sessions/lib/groupTurnBlocks';
import { cn } from '@/shared/utils/cn';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

interface ActivityGroupProps {
  sessionId: string;
  blocks: ActivityBlock[];
  /** The agent is still inside this block: it shows the live action instead of a summary. */
  active: boolean;
  /** When the turn started, for the live elapsed counter. */
  since?: string;
}

/** Reasoning is context, not the answer: a folded line that opens onto the full text. */
const ThoughtRow = memo(function ThoughtRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const headline = thinkingHeadline(text);

  return (
    <li className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="group/row flex w-full min-w-0 items-center gap-2 rounded-md py-1 pr-1.5 text-left text-[13px] transition hover:bg-surface-2/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <span className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface">
          <ThinkingIcon className="size-3.5 text-ink-subtle" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-ink-muted">Thought</span>
          {headline ? <span className="ml-1.5 text-ink-subtle">{headline}</span> : null}
        </span>
        <ChevronRight className={cn('size-3.5 shrink-0 text-ink-subtle opacity-0 transition group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
          open && 'rotate-90 opacity-100')} />
      </button>
      {open ? (
        <div className="mt-1 mb-2 ml-7 max-h-80 animate-fade-in overflow-auto rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-6 text-ink-muted">
          <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}>
            <MarkdownContent text={text} />
          </Suspense>
        </div>
      ) : null}
    </li>
  );
});

/** The live line: the action in flight (the latest one when tools run in parallel), else the last thought. */
const currentAction = (blocks: ActivityBlock[]): { label: string; detail: string | null } => {
  const running = [...blocks].reverse().find((block) => block.kind === 'step' && block.step.status === 'running');
  const last = running ?? blocks[blocks.length - 1];
  if (last?.kind === 'step' && last.step.status === 'running') {
    const description = describeStep(last.step);
    return { label: description.verb, detail: description.detail };
  }
  if (last?.kind === 'thinking') return { label: thinkingHeadline(last.text) ?? 'Thinking', detail: null };
  return { label: blocks.length ? 'Working' : 'Thinking', detail: null };
};

/**
 * Everything the agent does between two messages to the user, folded into one line. While it runs,
 * the line names the current action with a moving highlight; once the agent speaks again (or asks,
 * or the turn ends) it settles into a summary — "Explored 3 files · Ran 2 commands" — and folds
 * itself, so the transcript reads as the conversation and the log is one click away.
 */
export const ActivityGroup = memo(function ActivityGroup({ sessionId, blocks, active, since }: ActivityGroupProps) {
  const [open, setOpen] = useState(false);
  const [wasActive, setWasActive] = useState(active);

  // The block folds itself when the agent moves on, whatever the user had opened while it ran.
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setOpen(false);
  }

  const expandable = blocks.length > 0;
  const summary = active ? null : summarizeActivity(blocks);
  const action = active ? currentAction(blocks) : null;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className="group flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default"
      >
        {action ? (
          <WorkingStatus label={action.label} detail={action.detail} since={since} />
        ) : summary ? (
          <span className="min-w-0 truncate text-[13px] text-ink-subtle transition group-enabled:group-hover:text-ink-muted">
            {summary.text}
            {summary.failed ? <span className="ml-1.5 text-danger">· {summary.failed} failed</span> : null}
          </span>
        ) : null}
        {expandable ? (
          <ChevronRight className={cn('size-3.5 shrink-0 text-ink-subtle transition group-hover:text-ink-muted', open && 'rotate-90')} />
        ) : null}
      </button>

      {expandable && open ? (
        <ol className="relative mt-1.5 flex animate-fade-in flex-col before:absolute before:top-3 before:bottom-3 before:left-2.5 before:w-px before:bg-line">
          {blocks.map((block) => block.kind === 'step'
            ? <ActivityStepRow key={blockKey(block)} sessionId={sessionId} step={block.step} />
            : <ThoughtRow key={blockKey(block)} text={block.text} />)}
        </ol>
      ) : null}
    </div>
  );
});
