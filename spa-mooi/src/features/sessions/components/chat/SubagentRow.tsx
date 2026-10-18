import { ChevronRight } from 'lucide-react';
import { useSubagentParam } from '@/features/sessions/hooks/useSubagentParam';
import { isTerminalSubagentStatus } from '@/features/sessions/lib/isTerminalSubagentStatus';
import { subagentMeta } from '@/features/sessions/lib/subagentMeta';
import { subagentStatusLabel, subagentStatusPulses, subagentStatusTone } from '@/features/sessions/lib/subagentStatusTone';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';
import { StatusDot } from '@/shared/components/StatusDot';
import { toneText } from '@/shared/styles/toneText';
import { cn } from '@/shared/utils/cn';

interface SubagentRowProps {
  subagent: TranscriptSubagent;
  /** How deep in other delegations it was launched, in a flat list of every subagent. */
  depth?: number;
}

const INDENT_REM = 1;

/**
 * One delegation in a single line: its task, what it is, and how it stands — with the result's
 * first line once it finished. Opens the agent's own panel; nothing here competes with the main
 * agent's answer for space.
 */
export const SubagentRow = ({ subagent, depth = 0 }: SubagentRowProps) => {
  const { agentId, open } = useSubagentParam();
  const tone = subagentStatusTone(subagent.status);
  const status = subagentStatusLabel(subagent.status);
  const finished = isTerminalSubagentStatus(subagent.status);
  const secondary = finished && subagent.result ? subagent.result : subagentMeta(subagent).join(' · ');
  const description = subagent.description ?? 'Delegated task';
  const selected = agentId === subagent.toolUseId;

  return (
    <li className={cn(subagent.status === 'waiting' && 'bg-warning-soft/40')}>
      <button
        type="button"
        onClick={() => open(subagent.toolUseId)}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${description}, ${status}. Open subagent`}
        style={depth ? { paddingLeft: `${0.75 + depth * INDENT_REM}rem` } : undefined}
        className={cn(
          'flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
          selected && 'bg-surface-2',
        )}
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
        <ChevronRight className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
      </button>
    </li>
  );
};
