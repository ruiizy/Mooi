import type { AuthSession } from '@/features/auth/types/AuthSession';
import type { SessionResponse } from '@/features/auth/types/SessionResponse';

/** Turns the server's relative `expiresIn` (seconds) into an absolute epoch-ms deadline. */
export const toAuthSession = (response: SessionResponse): AuthSession => ({
  accessToken: response.accessToken,
  expiresAt: Date.now() + response.expiresIn * 1000,
});
