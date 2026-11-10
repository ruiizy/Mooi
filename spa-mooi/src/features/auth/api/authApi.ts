import { env } from '@/config/env';
import type { RevokedSessionsResponse } from '@/features/auth/types/RevokedSessionsResponse';
import type { SessionResponse } from '@/features/auth/types/SessionResponse';

/**
 * `X-Mooi-Auth` marks a cookie-transport client: the server then keeps the refresh token out of the
 * body, and a cross-origin page cannot send the header without a preflight (CSRF guard).
 */
const authHeaders = { 'Content-Type': 'application/json', 'X-Mooi-Auth': 'cookie' } as const;

/** A hung renewal would hold the cross-tab lock, so every auth call gives up eventually. */
const TIMEOUT_MS = 15_000;

/** A failed auth call; `status` tells a suspended account (403) apart from any other failure. */
export class AuthRequestError extends Error {
  readonly status: number;

  constructor(path: string, status: number) {
    super(`Request to ${path} failed with ${status}`);
    this.status = status;
  }
}

const send = async (path: string, init: RequestInit): Promise<Response> => {
  const response = await fetch(`${env.apiBaseUrl}${path}`, {
    ...init,
    method: 'POST',
    credentials: 'include',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AuthRequestError(path, response.status);
  }

  return response;
};

const request = async <T>(path: string, init: RequestInit): Promise<T> => (await send(path, init)).json() as Promise<T>;

export const loginWithGoogle = (idToken: string): Promise<SessionResponse> =>
  request('/auth/google', { headers: authHeaders, body: JSON.stringify({ idToken }) });

/** The refresh token travels in the cookie; `legacyRefreshToken` only migrates a pre-cookie sign-in once. */
export const refreshSession = (legacyRefreshToken?: string): Promise<SessionResponse> =>
  request('/auth/refresh', {
    headers: authHeaders,
    body: JSON.stringify(legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {}),
  });

export const logout = async (): Promise<void> => {
  await send('/auth/logout', { headers: authHeaders, body: '{}' });
};

export const logoutEverywhere = (accessToken: string): Promise<RevokedSessionsResponse> =>
  request('/auth/logout-all', { headers: { ...authHeaders, Authorization: `Bearer ${accessToken}` }, body: '{}' });
