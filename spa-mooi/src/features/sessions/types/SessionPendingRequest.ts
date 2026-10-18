import type { AgentQuestion } from '@/features/sessions/types/AgentQuestion';

/**
 * The transcript's own view of a blocked turn — unlike `Session.pending` (just `{kind, requestId}`,
 * mirrored from the REST payload), this carries the full request the SPA needs to render
 * `PermissionRequestCard` / `QuestionCard`, which only ever arrives on the `permission.request` /
 * `question.request` SSE event itself.
 */
interface RequestOwner {
  /** The delegated agent that asked; absent when the main agent did. */
  parentToolUseId?: string;
  /** Asked by a background agent: survives the main turn ending. */
  background?: boolean;
}

export type SessionPendingRequest = RequestOwner & (
  | { kind: 'permission'; requestId: string; toolName: string; title: string; input: Record<string, unknown> }
  | { kind: 'question'; requestId: string; questions: AgentQuestion[] });
