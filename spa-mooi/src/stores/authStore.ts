import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { env } from '@/config/env';
import { stashLegacyRefreshToken } from '@/features/auth/lib/legacyRefreshToken';
import type { AuthPlayer } from '@/features/auth/types/AuthPlayer';
import type { AuthState } from '@/stores/types/AuthState';

interface LegacyAuthState {
  player?: AuthPlayer | null;
  session?: { refreshToken?: string } | null;
}

/**
 * Only the non-secret profile is persisted (instant shell render, cross-tab sign-in and sign-out
 * signal). The access token lives in memory and the refresh token in an HttpOnly cookie. Versions
 * before 3 stored both here: the refresh token is handed to memory once, to be traded for the cookie.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      player: null,
      suspended: false,
      signIn: (player) => set({ player, suspended: false }),
      setPlayer: (player) => set({ player }),
      clear: (options) => set({ player: null, suspended: options?.suspended ?? false }),
    }),
    {
      name: `${env.storagePrefix}:auth`,
      version: 3,
      partialize: ({ player }) => ({ player }),
      migrate: (persisted) => {
        const legacy = (persisted ?? {}) as LegacyAuthState;

        stashLegacyRefreshToken(legacy.session?.refreshToken);

        return { player: legacy.player ?? null } as AuthState;
      },
    },
  ),
);
