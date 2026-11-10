import type { PlayerRole } from '@/features/auth/types/PlayerRole';

/** One registered user as the administrators' directory lists them (mic-mooi `AdminFeature`). */
export interface AdminPlayer {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  role: PlayerRole;
  createdAt: string;
  /** The last time any of their sign-ins was used; `null` when they never came back. */
  lastSeenAt: string | null;
  bannedAt: string | null;
  /** Live sign-ins, i.e. signed-in devices. */
  signIns: number;
  projects: number;
  agentAccounts: number;
  githubLinked: boolean;
}
