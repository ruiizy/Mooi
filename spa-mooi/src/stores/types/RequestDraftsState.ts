import type { RequestDraft } from '@/features/sessions/types/RequestDraft';

export interface RequestDraftsState {
  /** By request id, which is unique across sessions. */
  drafts: Record<string, RequestDraft>;
  update: (requestId: string, patch: Partial<RequestDraft>) => void;
  discard: (requestIds: string[]) => void;
}
