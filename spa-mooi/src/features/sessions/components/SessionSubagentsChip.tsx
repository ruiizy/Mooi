import { Bot } from 'lucide-react';
import { sessionSubagentCounts } from '@/features/sessions/lib/sessionSubagentCounts';
import { subagentCountLabel, subagentStatusPulses, subagentStatusTone } from '@/features/sessions/lib/subagentStatusTone';
import type { SessionSubagents } from '@/features/sessions/types/SessionSubagents';
import { StatusDot } from '@/shared/components/StatusDot';
import { cn } from '@/shared/utils/cn';

interface SessionSubagentsChipProps {
  subagents?: SessionSubagents;
  /** Counts only, for tight rows; the full wording stays in the accessible name and the title. */
  compact?: boolean;
  className?: string;
}

/** The delegations a session row still has at work; a subagent waiting on the player stands out. */
export const SessionSubagentsChip = ({ subagents, compact = false, className }: SessionSubagentsChipProps) => {
  const counts = sessionSubagentCounts(subagents);
  if (!counts.length) return null;

  const label = counts.map(({ status, count }) => subagentCountLabel(status, count)).join(', ');
  const waiting = counts[0].status === 'waiting';

  return (
    <span
      role="img"
      aria-label={`Subagents: ${label}`}
      title={`Subagents: ${label}`}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums',
        waiting ? 'border-warning/40 bg-warning-soft text-warning' : 'border-line bg-surface-2 text-ink-muted',
        className,
      )}
    >
      <Bot className="size-3 shrink-0" aria-hidden />
      {counts.map(({ status, count }) => (
        <span key={status} className="flex min-w-0 items-center gap-1">
          <StatusDot tone={subagentStatusTone(status)} pulse={subagentStatusPulses(status)} />
          <span className="truncate">{compact ? count : subagentCountLabel(status, count)}</span>
        </span>
      ))}
    </span>
  );
};
