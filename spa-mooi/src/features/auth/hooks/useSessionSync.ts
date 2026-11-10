import { useEffect } from 'react';
import { fetchCurrentPlayer } from '@/features/auth/api/currentPlayerApi';
import { useAuthStore } from '@/stores/authStore';

/**
 * Re-reads the profile on mount and whenever the tab regains focus, so a profile changed elsewhere
 * shows up. It never signs out: a revoked sign-in is detected by the token provider (a 401 on renewal),
 * and a failure here is far more often the network than the session.
 */
export const useSessionSync = (): void => {
  useEffect(() => {
    let cancelled = false;

    const sync = () => {
      if (!useAuthStore.getState().player) {
        return;
      }

      fetchCurrentPlayer()
        .then((player) => {
          if (!cancelled) {
            useAuthStore.getState().setPlayer(player);
          }
        })
        .catch(() => {});
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        sync();
      }
    };

    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
};
