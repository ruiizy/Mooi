import { env } from '@/config/env';
import { getAccessToken } from '@/features/auth/lib/accessTokenProvider';
import { SessionExpiredError } from '@/features/auth/lib/authErrors';

const withAuth = (init: RequestInit | undefined, token: string): RequestInit => ({
  ...init,
  headers: { ...init?.headers, Authorization: `Bearer ${token}` },
});

/**
 * Fetches a URL with the current access token attached. On a 401 it renews once against a forced
 * token. The sign-in is ended by the token provider alone, and only on a real verdict: here a missing
 * token or a second 401 just throws `SessionExpiredError`, while `AuthUnavailableError` (offline,
 * server restarting) propagates untouched and leaves the player signed in.
 */
export const fetchWithAccessToken = async (url: string, init?: RequestInit): Promise<Response> => {
  const token = await getAccessToken();

  if (!token) {
    throw new SessionExpiredError();
  }

  const response = await fetch(url, withAuth(init, token));

  if (response.status !== 401) {
    return response;
  }

  const retryToken = await getAccessToken(true);

  if (!retryToken) {
    throw new SessionExpiredError();
  }

  const retried = await fetch(url, withAuth(init, retryToken));

  if (retried.status === 401) {
    throw new SessionExpiredError();
  }

  return retried;
};

export const authenticatedFetch = (path: string, init?: RequestInit): Promise<Response> =>
  fetchWithAccessToken(`${env.apiBaseUrl}${path}`, init);
