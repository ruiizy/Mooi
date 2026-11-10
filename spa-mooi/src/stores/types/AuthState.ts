import type { AuthPlayer } from '@/features/auth/types/AuthPlayer';

export interface AuthState {
  player: AuthPlayer | null;
  /** Set when the sign-out was caused by a suspension; read once by the login page. Not persisted. */
  suspended: boolean;
  signIn: (player: AuthPlayer) => void;
  setPlayer: (player: AuthPlayer) => void;
  clear: (options?: { suspended?: boolean }) => void;
}
