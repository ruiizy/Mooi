import type { ReactNode } from 'react';
import { Bot } from 'lucide-react';
import { SubagentRow } from './SubagentRow';
import { summarizeSubagents } from '@/features/sessions/lib/summarizeSubagents';
import { subagentCountLabel, subagentStatusTone } from '@/features/sessions/lib/subagentStatusTone';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';
import { StatusDot } from '@/shared/components/StatusDot';

interface SubagentGroupProps {
  subagents: TranscriptSubagent[];
  /** Null for the main agent; the delegating subagent's name when nested. */
  delegatedBy: string | null;
  renderActivity: (blocks: TranscriptBlock[], delegatedBy: string) => ReactNode;
}

/**
 * Delegations launched together, one row each. A fan-out gets a header counting every state
 * present, so a glance tells how many agents still work, wait on the player or failed.
 */
export const SubagentGroup = ({ subagents, delegatedBy, renderActivity }: SubagentGroupProps) => {
  const summary = summarizeSubagents(subagents);
  const titled = subagents.length > 1 || delegatedBy !== null;
  const title = subagents.length === 1 ? '1 subagent' : `${subagents.length} subagents`;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2/40">
      {titled ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1.5 font-extrabold text-ink-muted">
            <Bot className="size-3.5" aria-hidden />
            {title}
            {delegatedBy ? <span className="font-semibold text-ink-subtle">· from {delegatedBy}</span> : null}
          </span>
          {subagents.length > 1 ? (
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-subtle">
              {summary.map(({ status, count }) => (
                <span key={status} className="flex items-center gap-1.5">
                  <StatusDot tone={subagentStatusTone(status)} />
                  {subagentCountLabel(status, count)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {subagents.map((subagent) => (
          <SubagentRow key={subagent.toolUseId} subagent={subagent} renderActivity={renderActivity} />
        ))}
      </ul>
    </div>
  );
};
