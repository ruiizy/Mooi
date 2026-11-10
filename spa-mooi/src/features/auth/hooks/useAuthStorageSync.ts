import { useEffect } from 'react';
import { env } from '@/config/env';
import { dropAccessSession } from '@/features/auth/lib/accessTokenProvider';
import { useAuthStore } from '@/stores/authStore';

const STORAGE_KEY = `${env.storagePrefix}:auth`;

/** Rehydrates the store when another tab writes the persisted auth state (sign-in or sign-out there). */
export const useAuthStorageSync = (): void => {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        void Promise.resolve(useAuthStore.persist.rehydrate()).then(() => {
          if (!useAuthStore.getState().player) {
            dropAccessSession();
          }
        });
      }
    };

    window.addEventListener('storage', onStorage);

    return () => window.removeEventListener('storage', onStorage);
  }, []);
};
