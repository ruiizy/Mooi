import { X } from 'lucide-react';
import { subagentMeta } from '@/features/sessions/lib/subagentMeta';
import { subagentStatusLabel, subagentStatusPulses, subagentStatusTone } from '@/features/sessions/lib/subagentStatusTone';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';
import { IconButton } from '@/shared/components/IconButton';
import { StatusDot } from '@/shared/components/StatusDot';
import { toneText } from '@/shared/styles/toneText';
import { cn } from '@/shared/utils/cn';

interface SubagentPanelHeaderProps {
  subagent: TranscriptSubagent;
  /** The delegation that launched it; null when the main agent did. */
  parent: TranscriptSubagent | null;
  headingId: string;
  onClose: () => void;
}

/** Who this agent is, who delegated to it and how it stands — the panel's fixed top. */
export const SubagentPanelHeader = ({ subagent, parent, headingId, onClose }: SubagentPanelHeaderProps) => {
  const tone = subagentStatusTone(subagent.status);
  const meta = subagentMeta(subagent);
  const delegator = parent ? parent.agentType ?? parent.description ?? 'a subagent' : 'the main agent';

  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
          <span className={cn('flex items-center gap-1.5 font-bold', toneText(tone))}>
            <StatusDot tone={tone} pulse={subagentStatusPulses(subagent.status)} />
            {subagentStatusLabel(subagent.status)}
          </span>
          <span className="font-extrabold text-ink-muted">{subagent.agentType ?? 'Subagent'}</span>
          <span>· delegated by {delegator}</span>
        </p>
        <h2 id={headingId} className="mt-1 text-[17px] font-extrabold tracking-[-0.02em] break-words text-ink">
          {subagent.description ?? 'Delegated task'}
        </h2>
        {meta.length ? <p className="mt-0.5 text-xs text-ink-subtle">{meta.join(' · ')}</p> : null}
      </div>
      <IconButton icon={X} label="Close subagent" onClick={onClose} />
    </header>
  );
};
