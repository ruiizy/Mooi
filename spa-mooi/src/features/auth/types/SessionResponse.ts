import type { AuthPlayer } from '@/features/auth/types/AuthPlayer';

export interface SessionResponse {
  accessToken: string;
  /** Seconds, relative: a client with a skewed clock still renews in time. */
  expiresIn: number;
  player: AuthPlayer;
}
