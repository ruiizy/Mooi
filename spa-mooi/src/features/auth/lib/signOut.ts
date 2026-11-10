import { logout, logoutEverywhere } from '@/features/auth/api/authApi';
import { dropAccessSession, getAccessToken } from '@/features/auth/lib/accessTokenProvider';
import { useAuthStore } from '@/stores/authStore';

const endLocally = (): void => {
  dropAccessSession();
  useAuthStore.getState().clear();
};

/** Ends the local session first, then tells the server (which clears the cookie). The button always wins. */
export const signOut = async (): Promise<void> => {
  endLocally();
  await logout().catch(() => {});
};

/** Revokes every session for the player, including this one. */
export const signOutEverywhere = async (): Promise<void> => {
  const token = await getAccessToken().catch(() => null);

  endLocally();

  // Without a token, at least end this device server side.
  await (token ? logoutEverywhere(token) : logout()).catch(() => {});
};
