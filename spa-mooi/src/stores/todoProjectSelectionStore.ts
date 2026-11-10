import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { env } from '@/config/env';

interface TodoProjectSelectionState {
  /** An absent selection shows all projects; an empty array deliberately shows none. */
  selections: Record<string, string[] | undefined>;
  select: (playerId: string, projectIds: string[] | null) => void;
}

/** A view preference on this device, kept separately for each signed-in player. */
export const useTodoProjectSelectionStore = create<TodoProjectSelectionState>()(
  persist(
    (set) => ({
      selections: {},
      select: (playerId, projectIds) => set((state) => ({
        selections: { ...state.selections, [playerId]: projectIds ?? undefined },
      })),
    }),
    { name: `${env.storagePrefix}:todos-project-selection` },
  ),
);
