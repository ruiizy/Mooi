import { create } from 'zustand';
import type { RequestDraftsState } from '@/stores/types/RequestDraftsState';

/**
 * Unsent answers to pending questions and approvals. A draft lives until its request leaves the
 * pending queue (answered from anywhere, denied, or ended with its turn), never just because the
 * card showing it unmounted. Not persisted: a reload replays the requests but not their drafts.
 */
export const useRequestDraftsStore = create<RequestDraftsState>((set) => ({
  drafts: {},
  update: (requestId, patch) => set((state) => ({
    drafts: { ...state.drafts, [requestId]: { ...state.drafts[requestId], ...patch } },
  })),
  discard: (requestIds) => set((state) => {
    if (!requestIds.some((id) => id in state.drafts)) return state;
    const drafts = { ...state.drafts };
    requestIds.forEach((id) => delete drafts[id]);
    return { drafts };
  }),
}));
