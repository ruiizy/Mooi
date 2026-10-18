import { PendingRequestCard } from './PendingRequestCard';
import type { PendingRequestActions } from '@/features/sessions/types/PendingRequestActions';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

interface SubagentRequestsProps {
  subagent: TranscriptSubagent;
  requests: SessionPendingRequest[];
  actions: PendingRequestActions;
}

/** What this agent is waiting on the player for, answerable right here and first in its panel. */
export const SubagentRequests = ({ subagent, requests, actions }: SubagentRequestsProps) => {
  if (requests.length === 0) return null;

  return (
    <section aria-label="Waiting for your answer" className="flex flex-col gap-3">
      <h3 className="text-[10px] font-extrabold tracking-[0.08em] text-warning uppercase">Waiting for your answer</h3>
      {requests.map((request) => (
        <PendingRequestCard key={request.requestId} request={request} owner={subagent} showOwner={false}
          busy={actions.busy} editable={actions.editableToolInput} onAllowPermission={actions.onAllowPermission}
          onDenyPermission={actions.onDenyPermission} onAnswerQuestion={actions.onAnswerQuestion} />
      ))}
    </section>
  );
};
