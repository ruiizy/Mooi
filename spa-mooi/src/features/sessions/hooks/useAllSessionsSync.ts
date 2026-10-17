import { useEffect } from 'react';
import { useSessionsSync } from '@/features/sessions/hooks/useSessionsSync';
import { useSessionsSyncStore } from '@/stores/sessionsSyncStore';

/**
 * Keeps every open session of the player live for as long as the app shell is mounted, so their
 * status shows on any screen, and publishes the poll's progress for screens that report it.
 */
export const useAllSessionsSync = (): void => {
  const { loading, error, reload } = useSessionsSync(undefined);

  useEffect(() => {
    useSessionsSyncStore.getState().setSync({ loading, error, reload });
  }, [loading, error, reload]);
};
