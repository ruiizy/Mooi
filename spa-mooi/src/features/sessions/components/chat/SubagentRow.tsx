import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { SubagentDetails } from './SubagentDetails';
import { isTerminalSubagentStatus } from '@/features/sessions/lib/isTerminalSubagentStatus';
import { subagentMeta } from '@/features/sessions/lib/subagentMeta';
import { subagentStatusLabel, subagentStatusPulses, subagentStatusTone } from '@/features/sessions/lib/subagentStatusTone';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';
import { StatusDot } from '@/shared/components/StatusDot';
import { toneText } from '@/shared/styles/toneText';
import { cn } from '@/shared/utils/cn';

interface SubagentRowProps {
  subagent: TranscriptSubagent;
  renderActivity: (blocks: TranscriptBlock[], delegatedBy: string) => ReactNode;
  /** How deep in other delegations it was launched, in a flat list of every subagent. */
  depth?: number;
}

const INDENT_REM = 1;

/**
 * One delegation in a single line: its task, what it is, and how it stands — with the result's
 * first line once it finished. The details unfold in place; nothing here competes with the main
 * agent's answer for space.
 */
export const SubagentRow = ({ subagent, renderActivity, depth = 0 }: SubagentRowProps) => {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const tone = subagentStatusTone(subagent.status);
  const status = subagentStatusLabel(subagent.status);
  const finished = isTerminalSubagentStatus(subagent.status);
  const secondary = finished && subagent.result ? subagent.result : subagentMeta(subagent).join(' · ');
  const description = subagent.description ?? 'Delegated task';

  return (
    <li className={cn(subagent.status === 'waiting' && 'bg-warning-soft/40')}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={`${description}, ${status}`}
        style={depth ? { paddingLeft: `${0.75 + depth * INDENT_REM}rem` } : undefined}
        className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <StatusDot tone={tone} pulse={subagentStatusPulses(subagent.status)} />

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13px] font-bold text-ink">{description}</span>
            {subagent.agentType ? (
              <span className="hidden shrink-0 text-[11px] font-semibold text-ink-subtle sm:inline">{subagent.agentType}</span>
            ) : null}
          </span>
          {secondary ? <span className="block truncate text-[11px] text-ink-subtle">{secondary}</span> : null}
        </span>

        <span className={cn('shrink-0 text-[11px] font-bold', toneText(tone))}>{status}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-ink-subtle transition', open && 'rotate-180')} aria-hidden />
      </button>

      {open ? (
        <div id={detailsId} className="border-t border-line bg-canvas/40 px-3 py-3">
          <SubagentDetails subagent={subagent} renderActivity={renderActivity} />
        </div>
      ) : null}
    </li>
  );
};
