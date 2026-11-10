import { authenticatedFetch } from '@/features/auth/lib/authenticatedFetch';
import type { GithubAuthorizationResponse } from '@/features/github/types/GithubAuthorizationResponse';
import type { GithubConnection } from '@/features/github/types/GithubConnection';
import type { GithubConnectionResponse } from '@/features/github/types/GithubConnectionResponse';
import { apiErrorMessage } from '@/shared/utils/apiErrorMessage';

const AUTHORIZATION_PATH = '/me/github/authorization';
const CONNECTION_PATH = '/me/github/connection';

/**
 * Opens the flow. The API answers with ready-made URLs carrying a state it signed for this player,
 * so nothing here has to know the client id or protect the round trip itself.
 *
 * Both URLs come back from the one call because both are minted from the same state: whichever the
 * player is sent to, GitHub closes the loop on the same callback.
 */
export const startGithubAuthorization = async (): Promise<GithubAuthorizationResponse> => {
  const response = await authenticatedFetch(AUTHORIZATION_PATH, { method: 'POST' });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not start the GitHub authorization.'));
  }

  return (await response.json()) as GithubAuthorizationResponse;
};

/** Redeems the authorization code. Sent with the player's own token, which is what binds the link. */
export const completeGithubAuthorization = async (
  code: string,
  state: string,
): Promise<GithubConnection | null> => {
  const response = await authenticatedFetch(CONNECTION_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state }),
  });

  if (!response.ok) {
    throw new Error(`Request to ${CONNECTION_PATH} failed with ${response.status}`);
  }

  const body = (await response.json()) as GithubConnectionResponse;

  return body.connection;
};

export const fetchGithubConnection = async (): Promise<GithubConnection | null> => {
  const response = await authenticatedFetch(CONNECTION_PATH);

  if (!response.ok) {
    throw new Error(`Request to ${CONNECTION_PATH} failed with ${response.status}`);
  }

  const body = (await response.json()) as GithubConnectionResponse;

  return body.connection;
};

export const disconnectGithub = async (): Promise<void> => {
  const response = await authenticatedFetch(CONNECTION_PATH, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(`Request to ${CONNECTION_PATH} failed with ${response.status}`);
  }
};
