import { useEffect, useId, useMemo, useRef } from 'react';
import { SubagentDetails } from './SubagentDetails';
import { SubagentPanelHeader } from './SubagentPanelHeader';
import { SubagentRequests } from './SubagentRequests';
import { useSubagentParam } from '@/features/sessions/hooks/useSubagentParam';
import { collectSubagents } from '@/features/sessions/lib/collectSubagents';
import { subagentStatusLabel } from '@/features/sessions/lib/subagentStatusTone';
import type { PendingRequestActions } from '@/features/sessions/types/PendingRequestActions';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import { Modal } from '@/shared/components/Modal';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { useOnEscape } from '@/shared/hooks/useOnEscape';

interface SubagentPanelProps {
  sessionId: string;
  entries: TranscriptEntry[];
  pending: SessionPendingRequest[];
  showThinking: boolean;
  actions: PendingRequestActions;
}

/**
 * The subagent named by `?agent=`: a side panel beside the conversation on wide screens, a sheet
 * over it below. Its timeline is read-only and follows the transcript live; the only input it
 * takes is an answer to what this agent itself is waiting on, shown first.
 */
export const SubagentPanel = ({ sessionId, entries, pending, showThinking, actions }: SubagentPanelProps) => {
  const { agentId, close } = useSubagentParam();
  const wide = useMediaQuery('(min-width: 1024px)');
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const found = useMemo(() => (agentId ? collectSubagents(entries).find(({ subagent }) => subagent.toolUseId === agentId) ?? null : null),
    [agentId, entries]);
  const requests = useMemo(() => pending.filter((request) => agentId && request.parentToolUseId === agentId), [agentId, pending]);

  useOnEscape(close, Boolean(agentId) && wide);
  useEffect(() => {
    if (agentId && wide) panelRef.current?.focus({ preventScroll: true });
  }, [agentId, wide]);

  // Until the stream replays there is nothing to look up; a link to a trimmed agent says so after.
  if (!agentId || entries.length === 0) return null;

  const missing = <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">This subagent is no longer in the retained history of the session.</p>;
  const body = found ? (
    <div className="flex flex-col gap-6">
      <SubagentRequests subagent={found.subagent} requests={requests} actions={actions} />
      <SubagentDetails sessionId={sessionId} subagent={found.subagent} showThinking={showThinking} />
    </div>
  ) : missing;

  if (!wide) {
    return (
      <Modal open onClose={close} size="lg" title={found?.subagent.description ?? 'Subagent'}
        description={found ? `${subagentStatusLabel(found.subagent.status)} · ${found.subagent.agentType ?? 'Subagent'}` : undefined}>
        {body}
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">{body}</div>
        </>
      ) : missing}
    </aside>
  );
};
