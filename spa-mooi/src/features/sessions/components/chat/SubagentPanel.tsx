import { useEffect, useId, useMemo, useRef } from 'react';
import { SubagentDetails } from './SubagentDetails';
import { SubagentPanelHeader } from './SubagentPanelHeader';
import { useSubagentParam } from '@/features/sessions/hooks/useSubagentParam';
import { collectSubagents } from '@/features/sessions/lib/collectSubagents';
import { subagentStatusLabel } from '@/features/sessions/lib/subagentStatusTone';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import { Modal } from '@/shared/components/Modal';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useOnEscape } from '@/shared/hooks/useOnEscape';

interface SubagentPanelProps {
  sessionId: string;
  entries: TranscriptEntry[];
  showThinking: boolean;
}

/**
 * The subagent named by `?agent=`, read-only: a side panel beside the conversation on wide
 * screens, a sheet over it below. It follows the transcript live, so a working agent's timeline
 * keeps growing while it is open.
 */
export const SubagentPanel = ({ sessionId, entries, showThinking }: SubagentPanelProps) => {
  const { agentId, close } = useSubagentParam();
  const wide = useMediaQuery('(min-width: 1024px)');
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const found = useMemo(() => (agentId ? collectSubagents(entries).find(({ subagent }) => subagent.toolUseId === agentId) ?? null : null),
    [agentId, entries]);

  useOnEscape(close, Boolean(agentId) && wide);
  useEffect(() => {
    if (agentId && wide) panelRef.current?.focus({ preventScroll: true });
  }, [agentId, wide]);

  // Until the stream replays there is nothing to look up; a link to a trimmed agent says so after.
  if (!agentId || entries.length === 0) return null;

  const missing = <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">This subagent is no longer in the retained history of the session.</p>;

  if (!wide) {
    return (
      <Modal open onClose={close} size="lg" title={found?.subagent.description ?? 'Subagent'}
        description={found ? `${subagentStatusLabel(found.subagent.status)} · ${found.subagent.agentType ?? 'Subagent'}` : undefined}>
        {found ? <SubagentDetails sessionId={sessionId} subagent={found.subagent} showThinking={showThinking} /> : missing}
      </Modal>
    );
  }

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={found ? headingId : undefined}
      aria-label={found ? undefined : 'Subagent'}
      className="flex min-h-0 w-[min(32rem,42%)] shrink-0 animate-panel-in flex-col border-l border-line bg-canvas outline-none"
    >
      {found ? (
        <>
          <SubagentPanelHeader subagent={found.subagent} parent={found.parent} headingId={headingId} onClose={close} />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
            <SubagentDetails sessionId={sessionId} subagent={found.subagent} showThinking={showThinking} />
          </div>
        </>
      ) : missing}
    </aside>
  );
};
