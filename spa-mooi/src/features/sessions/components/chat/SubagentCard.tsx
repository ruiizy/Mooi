import { lazy, Suspense, useId, useState, type ReactNode } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { SubagentSection } from './SubagentSection';
import { SubagentStatusPill } from './SubagentStatusPill';
import { isTerminalSubagentStatus } from '@/features/sessions/lib/isTerminalSubagentStatus';
import { subagentMeta } from '@/features/sessions/lib/subagentMeta';
import { transcriptBlockKey } from '@/features/sessions/lib/transcriptBlockKey';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';
import { cn } from '@/shared/utils/cn';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

interface SubagentCardProps {
  subagent: TranscriptSubagent;
  /** Who delegated: the main agent, or the delegation this one is nested in. */
  delegatedBy: string;
  renderBlock: (block: TranscriptBlock, delegatedBy: string) => ReactNode;
}

const markdown = (text: string) => (
  <div className="max-h-72 overflow-auto rounded-lg border border-line bg-canvas/60 px-3 py-2.5 text-[13px] leading-6 text-ink-muted">
    <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}><MarkdownContent text={text} /></Suspense>
  </div>
);

/**
 * One delegation to another agent, kept apart from the main agent's own work: what was asked, of
 * whom, how it is going and what came back. Folded by default so the conversation stays readable;
 * the result previews while folded once the agent finished.
 */
export const SubagentCard = ({ subagent, delegatedBy, renderBlock }: SubagentCardProps) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const name = subagent.agentType ?? 'Subagent';
  const meta = subagentMeta(subagent);
  const finished = isTerminalSubagentStatus(subagent.status);
  const activityNote = !subagent.streamsActivity
    ? 'This provider does not stream the agent’s own activity, only its status and result.'
    : finished ? 'The agent reported no activity.' : 'Waiting for the agent’s first activity…';

  return (
    <div className="overflow-hidden rounded-xl border border-line border-l-2 border-l-info/60 bg-surface-2/40">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
          <Bot className="size-4" aria-hidden />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-ink-subtle">
            <span className="font-extrabold text-ink-muted">{name}</span>
            <span>· delegated by {delegatedBy}</span>
          </span>
          <span className="mt-0.5 block text-sm font-bold break-words text-ink">{subagent.description ?? 'Delegated task'}</span>
          {meta.length ? <span className="mt-0.5 block truncate text-[11px] text-ink-subtle">{meta.join(' · ')}</span> : null}
        </span>

        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <SubagentStatusPill status={subagent.status} />
          <ChevronDown className={cn('size-3.5 text-ink-subtle transition', open && 'rotate-180')} aria-hidden />
        </span>
      </button>

      {!open && finished && subagent.result ? (
        <p className="line-clamp-2 border-t border-line px-3 py-2 text-xs text-ink-muted">{subagent.result}</p>
      ) : null}

      {open ? (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-line px-3 py-3">
          <SubagentSection title="Instructions and context" empty="The provider did not share the instructions sent to this agent.">
            {subagent.prompt ? markdown(subagent.prompt) : undefined}
          </SubagentSection>

          <SubagentSection title="Activity" empty={activityNote}>
            {subagent.blocks.length ? (
              <div className="flex flex-col gap-2">
                {subagent.blocks.map((block) => <div key={transcriptBlockKey(block)}>{renderBlock(block, name)}</div>)}
              </div>
            ) : undefined}
          </SubagentSection>

          <SubagentSection title="Result"
            empty={finished ? 'The agent returned no result.' : 'The result appears here when the agent finishes.'}>
            {subagent.result ? markdown(subagent.result) : undefined}
          </SubagentSection>
        </div>
      ) : null}
    </div>
  );
};
