import { env } from '@/config/env';
import { AuthRequestError, refreshSession } from '@/features/auth/api/authApi';
import { onAuth, postAuth } from '@/features/auth/lib/authChannel';
import { AccountSuspendedError, AuthUnavailableError, SessionExpiredError } from '@/features/auth/lib/authErrors';
import { stashLegacyRefreshToken, takeLegacyRefreshToken } from '@/features/auth/lib/legacyRefreshToken';
import { toAuthSession } from '@/features/auth/lib/toAuthSession';
import type { AuthSession } from '@/features/auth/types/AuthSession';
import type { SessionResponse } from '@/features/auth/types/SessionResponse';
import { useAuthStore } from '@/stores/authStore';

/** A token this close to its deadline is renewed before it is used (and ahead of time by the renewal hook). */
export const RENEW_AHEAD_MS = 60_000;

const LOCK_NAME = `${env.storagePrefix}:auth-refresh`;

/** Memory only. The long-lived credential is an HttpOnly cookie that scripts cannot read. */
let current: AuthSession | null = null;
let inFlight: Promise<string | null> | null = null;
/** A silent sign-in is only worth trying when the app opened signed out (nothing was stored). */
let silentSignInAllowed = useAuthStore.getState().player === null;

const listeners = new Set<() => void>();

const setCurrent = (session: AuthSession | null): void => {
  current = session;
  listeners.forEach((listener) => listener());
};

const fresh = (session: AuthSession | null): session is AuthSession =>
  session !== null && Date.now() < session.expiresAt - RENEW_AHEAD_MS;

/** One renewal at a time across every tab; without Web Locks the server's grace window keeps races safe. */
const withRefreshLock = <T>(work: () => Promise<T>): Promise<T> =>
  'locks' in navigator ? navigator.locks.request(LOCK_NAME, work) : work();

/** Memory-only session of this tab, shared with the others. */
export const setAccessSession = (session: AuthSession): void => {
  silentSignInAllowed = false;
  setCurrent(session);
  postAuth({ type: 'token', session });
};

/** Forgets the access token here and in the other tabs. */
export const dropAccessSession = (): void => {
  silentSignInAllowed = false;
  setCurrent(null);
  postAuth({ type: 'signed-out' });
};

export const accessSessionExpiresAt = (): number | null => current?.expiresAt ?? null;

export const subscribeAccessSession = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

onAuth((message) => {
  if (message.type === 'signed-out') {
    setCurrent(null);
  } else if (!current || message.session.expiresAt > current.expiresAt) {
    setCurrent(message.session);
  }
});

const adopt = (response: SessionResponse): void => {
  setAccessSession(toAuthSession(response));
  useAuthStore.getState().setPlayer(response.player);
};

/**
 * Trades the cookie for a new access token. Only a verdict from the server ends the sign-in (401
 * expired or revoked, 403 suspended); anything else (offline, timeout, 5xx) leaves it alone.
 */
const requestRenewal = async (): Promise<SessionResponse> => {
  const legacy = takeLegacyRefreshToken();

  try {
    return await refreshSession(legacy ?? undefined);
  } catch (failure) {
    if (failure instanceof AuthRequestError && failure.status === 403) {
      throw new AccountSuspendedError();
    }

    if (failure instanceof AuthRequestError && failure.status === 401) {
      throw new SessionExpiredError();
    }

    // Keep the migration for the next attempt.
    stashLegacyRefreshToken(legacy);

    throw new AuthUnavailableError();
  }
};

/**
 * `stale` is the token a forced renewal was asked to replace: if another tab already swapped it while
 * this one waited for the lock, that token is used instead of burning another rotation.
 */
const renew = (force: boolean, stale: string | null): Promise<string | null> =>
  withRefreshLock(async () => {
    if (fresh(current) && (!force || current.accessToken !== stale)) {
      return current.accessToken;
    }

    const response = await requestRenewal();

    adopt(response);

    return response.accessToken;
  });

const endSession = (failure: unknown): void => {
  silentSignInAllowed = false;
  dropAccessSession();
  useAuthStore.getState().clear({ suspended: failure instanceof AccountSuspendedError });
};

/**
 * A valid access token, renewed when it is missing or about to expire; `null` once the sign-in is
 * over (the store is then already cleared). Throws `AuthUnavailableError` when renewal could not be
 * attempted (offline, server down): the sign-in is kept, callers treat it as a network failure.
 */
export const getAccessToken = async (force = false): Promise<string | null> => {
  if (!useAuthStore.getState().player) {
    return null;
  }

  if (!force && fresh(current)) {
    return current.accessToken;
  }

  inFlight ??= renew(force, current?.accessToken ?? null)
    .catch((failure: unknown) => {
      if (failure instanceof SessionExpiredError) {
        endSession(failure);
      }

      throw failure;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (failure) {
    if (failure instanceof SessionExpiredError) {
      return null;
    }

    throw failure;
  }
};

/** Renews only when the token is missing or close to expiry; used by the proactive scheduler. */
export const renewIfDue = async (): Promise<void> => {
  if (useAuthStore.getState().player && !fresh(current)) {
    await getAccessToken();
  }
};

/**
 * Signs straight back in from the cookie when the app opens signed out but the cookie is still valid
 * (the stored profile was evicted, as Safari does). Once per page load, and never after a sign-out.
 */
export const trySilentSignIn = async (): Promise<void> => {
  if (!silentSignInAllowed) {
    return;
  }

  silentSignInAllowed = false;

  try {
    const response = await withRefreshLock(requestRenewal);

    adopt(response);
    useAuthStore.getState().signIn(response.player);
  } catch {
    // No cookie, or expired: the login page stays.
  }
};
