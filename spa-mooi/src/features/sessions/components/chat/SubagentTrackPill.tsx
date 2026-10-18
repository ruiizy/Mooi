import { forwardRef } from 'react';
import { Bot, ChevronUp } from 'lucide-react';
import { summarizeSubagents } from '@/features/sessions/lib/summarizeSubagents';
import { subagentCountLabel, subagentStatusPulses, subagentStatusTone } from '@/features/sessions/lib/subagentStatusTone';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';
import { StatusDot } from '@/shared/components/StatusDot';
import { cn } from '@/shared/utils/cn';

interface SubagentTrackPillProps {
  subagents: TranscriptSubagent[];
  open: boolean;
  panelId: string;
  onToggle: () => void;
}

/**
 * The session's delegations at a glance: one mark and count per state still worth attention —
 * waiting on the player first — and just the total once every agent finished.
 */
export const SubagentTrackPill = forwardRef<HTMLButtonElement, SubagentTrackPillProps>(
  function SubagentTrackPill({ subagents, open, panelId, onToggle }, ref) {
    const active = summarizeSubagents(subagents)
      .filter(({ status }) => status === 'waiting' || status === 'working' || status === 'failed');
    const total = subagents.length === 1 ? '1 subagent' : `${subagents.length} subagents`;
    const label = active.length ? active.map(({ status, count }) => subagentCountLabel(status, count)).join(', ') : total;
    const waiting = active.some(({ status }) => status === 'waiting');

    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Subagents: ${label}`}
        title="Subagents"
        className={cn(
          'flex h-8 max-w-full items-center gap-2 rounded-full border bg-surface px-3 text-xs font-bold text-ink-muted shadow-sm transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          waiting ? 'border-warning/50 bg-warning-soft/60' : 'border-line',
          open && 'text-ink',
        )}
      >
        <Bot className="size-3.5 shrink-0" aria-hidden />
        {active.length ? active.map(({ status, count }) => (
          <span key={status} className="flex shrink-0 items-center gap-1.5">
            <StatusDot tone={subagentStatusTone(status)} pulse={subagentStatusPulses(status)} />
            {subagentCountLabel(status, count)}
          </span>
        )) : <span className="truncate">{total}</span>}
        <ChevronUp className={cn('size-3.5 shrink-0 transition', open && 'rotate-180')} aria-hidden />
      </button>
    );
  },
);
