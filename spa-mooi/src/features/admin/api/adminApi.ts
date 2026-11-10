import type { AdminPlayer } from '@/features/admin/types/AdminPlayer';
import type { AdminSignIn } from '@/features/admin/types/AdminSignIn';
import { authenticatedFetch } from '@/features/auth/lib/authenticatedFetch';
import type { RevokedSessionsResponse } from '@/features/auth/types/RevokedSessionsResponse';
import { sessionsFetch } from '@/features/sessions/lib/sessionsFetch';
import { apiErrorMessage } from '@/shared/utils/apiErrorMessage';

// Identity (directory, sign-ins, bans) lives in mic-mooi; live chats live in mic-sessions.
const playerPath = (playerId: string) => `/admin/players/${encodeURIComponent(playerId)}`;

export const ADMIN_PAGE_SIZE = 50;

export const fetchAdminPlayers = async (query: string, offset: number): Promise<{ players: AdminPlayer[]; total: number }> => {
  const params = new URLSearchParams({ query, offset: String(offset), limit: String(ADMIN_PAGE_SIZE) });
  const response = await authenticatedFetch(`/admin/players?${params}`);
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not load the users.'));
  return response.json();
};

export const fetchPlayerSignIns = async (playerId: string): Promise<AdminSignIn[]> => {
  const response = await authenticatedFetch(`${playerPath(playerId)}/sign-ins`);
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not load the devices.'));
  return ((await response.json()) as { signIns: AdminSignIn[] }).signIns;
};

export const signOutPlayer = async (playerId: string): Promise<number> => {
  const response = await authenticatedFetch(`${playerPath(playerId)}/sign-out`, { method: 'POST' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not sign this user out.'));
  return ((await response.json()) as RevokedSessionsResponse).revokedSessions;
};

/** Suspends or restores an account; answers the new `bannedAt` (`null` once restored). */
export const setPlayerBanned = async (playerId: string, banned: boolean): Promise<string | null> => {
  const response = await authenticatedFetch(`${playerPath(playerId)}/ban`, { method: banned ? 'PUT' : 'DELETE' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, banned ? 'Could not ban this user.' : 'Could not restore this user.'));
  return ((await response.json()) as { bannedAt: string | null }).bannedAt;
};

export const closeAdminSession = async (sessionId: string): Promise<void> => {
  const response = await sessionsFetch(`/admin/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not close this session.'));
};

export const closePlayerSessions = async (playerId: string): Promise<number> => {
  const response = await sessionsFetch(`${playerPath(playerId)}/sessions`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not close the sessions.'));
  return ((await response.json()) as { closed: number }).closed;
};
