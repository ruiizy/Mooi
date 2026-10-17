import { create } from 'zustand';
import type { SessionsSyncState } from '@/stores/types/SessionsSyncState';

/**
 * Mirrors the shell's single player-wide `useSessionsSync` so every surface listing all sessions
 * (sidebar, Sessions page) shares one poll instead of starting its own.
 */
export const useSessionsSyncStore = create<SessionsSyncState>((set) => ({
  loading: true,
  error: null,
  reload: () => undefined,
  setSync: (sync) => set(sync),
}));
