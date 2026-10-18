import { Bot, ChevronRight } from 'lucide-react';
import { PermissionRequestCard } from './PermissionRequestCard';
import { QuestionCard } from './QuestionCard';
import { useSubagentParam } from '@/features/sessions/hooks/useSubagentParam';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

interface PendingRequestCardProps {
  request: SessionPendingRequest;
  /** The delegated agent that asked, when known. */
  owner: TranscriptSubagent | null;
  /** Off inside the asking agent's own panel, where who asks goes without saying. */
  showOwner: boolean;
  /** Other requests wait beside this one, so even the main agent has to say it is the asker. */
  queued?: boolean;
  busy: boolean;
  editable: boolean;
  onAllowPermission: (requestId: string, updatedInput?: Record<string, unknown>) => void;
  onDenyPermission: (requestId: string, message?: string) => void;
  onAnswerQuestion: (requestId: string, answers: Record<string, string | string[]>) => void;
}

/**
 * One question or approval waiting on the player, saying which agent asked. The same request can
 * show in the chat and in the asking agent's panel; answering either resolves it everywhere.
 */
export const PendingRequestCard = ({
  request, owner, showOwner, queued = false, busy, editable, onAllowPermission, onDenyPermission, onAnswerQuestion,
}: PendingRequestCardProps) => {
  const { open } = useSubagentParam();

  return (
    <div className="flex flex-col gap-1.5">
      {showOwner && request.parentToolUseId ? (
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <Bot className="size-3.5 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            The agent <span className="font-bold text-ink">{owner?.agentType ?? 'subagent'}</span> asks
            {owner?.description ? <> · {owner.description}</> : null}
            {request.background ? <span className="text-ink-subtle"> · in the background</span> : null}
          </span>
          {owner ? (
            <button type="button" onClick={() => open(owner.toolUseId)}
              className="flex min-h-8 shrink-0 items-center gap-0.5 rounded-full px-2 font-bold text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
              Open agent
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : showOwner && queued ? (
        <p className="text-xs text-ink-muted">
          The <span className="font-bold text-ink">main agent</span> asks
        </p>
      ) : null}

      {request.kind === 'permission' ? (
        <PermissionRequestCard request={request} editable={editable} busy={busy}
          onAllow={onAllowPermission} onDeny={onDenyPermission} />
      ) : (
        <QuestionCard request={request} busy={busy} onAnswer={onAnswerQuestion} />
      )}
    </div>
  );
};
