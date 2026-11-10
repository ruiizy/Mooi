import { useEffect } from 'react';
import {
  accessSessionExpiresAt,
  RENEW_AHEAD_MS,
  renewIfDue,
  subscribeAccessSession,
} from '@/features/auth/lib/accessTokenProvider';
import { AuthUnavailableError } from '@/features/auth/lib/authErrors';

const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

/**
 * Keeps the access token fresh while the app is in use, so requests rarely wait for a renewal: a timer
 * renews shortly before expiry while the tab is visible, and coming back (visible, online, focus, page
 * cache restore) renews at once if needed. A failed renewal is retried with backoff and never signs the
 * player out; hidden tabs do nothing and renew on demand when used again.
 */
export const useTokenRenewal = (): void => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let disposed = false;

    const schedule = (delayMs: number) => {
      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(() => void tick(), delayMs);
    };

    const plan = () => {
      const expiresAt = accessSessionExpiresAt();

      if (disposed || document.visibilityState !== 'visible' || expiresAt === null) {
        return;
      }

      schedule(Math.max(0, expiresAt - RENEW_AHEAD_MS - Date.now()));
    };

    const tick = async () => {
      try {
        await renewIfDue();
        failures = 0;
        plan();
      } catch (failure) {
        if (failure instanceof AuthUnavailableError && !disposed && document.visibilityState === 'visible') {
          failures += 1;
          schedule(Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** (failures - 1)));
        }
      }
    };

    const wake = () => {
      if (document.visibilityState === 'visible') {
        failures = 0;
        void tick();
      }
    };

    const unsubscribe = subscribeAccessSession(plan);

    wake();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);

    return () => {
      disposed = true;
      unsubscribe();

      if (timer) {
        clearTimeout(timer);
      }

      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
    };
  }, []);
};
