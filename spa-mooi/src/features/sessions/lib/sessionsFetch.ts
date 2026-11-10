import { env } from '@/config/env';
import { fetchWithAccessToken } from '@/features/auth/lib/authenticatedFetch';

/**
 * The same contract as `authenticatedFetch`, against `mic-sessions` instead of `mic-mooi`: both
 * services accept the same player token, so there is nothing sessions-specific beyond the base URL.
 */
export const sessionsFetch = (path: string, init?: RequestInit): Promise<Response> =>
  fetchWithAccessToken(`${env.sessionsBaseUrl}${path}`, init);
