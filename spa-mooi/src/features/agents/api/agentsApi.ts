import type { EngineDefaults } from '@/features/agents/types/EngineDefaults';
import { authenticatedFetch } from '@/features/auth/lib/authenticatedFetch';
import type { AgentAuthorizationResponse } from '@/features/agents/types/AgentAuthorizationResponse';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import type { AgentConnectionsResponse } from '@/features/agents/types/AgentConnectionsResponse';
import type { AgentProvider } from '@/features/agents/types/AgentProvider';
import type { AgentProvidersResponse } from '@/features/agents/types/AgentProvidersResponse';
import { apiErrorMessage } from '@/shared/utils/apiErrorMessage';

const providersPath = () => '/me/agents/providers';
const connectionsPath = () => '/me/agents/connections';
const authorizationPath = (provider: string) => `/me/agents/${provider}/authorization`;
const connectionPath = (provider: string) => `/me/agents/${provider}/connection`;

export const fetchAgentProviders = async (): Promise<AgentProvider[]> => {
  const response = await authenticatedFetch(providersPath());

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load the agent providers.'));
  }

  const body = (await response.json()) as AgentProvidersResponse;

  return body.providers;
};

export const fetchAgentConnections = async (): Promise<AgentConnection[]> => {
  const response = await authenticatedFetch(connectionsPath());

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load your agent connections.'));
  }

  const body = (await response.json()) as AgentConnectionsResponse;

  return body.connections;
};

/**
 * Opens the flow. The API answers with a ready-made URL carrying a state it signed for this
 * caller and provider, so nothing here has to know a client id or protect the round trip itself.
 * `409` means OAuth is not configured for this provider — the caller falls back to a pasted token.
 */
export const startAgentAuthorization = async (provider: string): Promise<AgentAuthorizationResponse> => {
  const response = await authenticatedFetch(authorizationPath(provider), { method: 'POST' });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not start the authorization.'));
  }

  return (await response.json()) as AgentAuthorizationResponse;
};

/** Redeems the authorization code. Sent with the caller's own token, which is what binds the link. */
export const completeAgentAuthorization = async (
  provider: string,
  code: string,
  state: string,
  name: string,
): Promise<AgentConnection> => {
  const response = await authenticatedFetch(connectionPath(provider), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, state, name }),
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not link this provider.'));
  }

  return (await response.json()) as AgentConnection;
};

/** Links a provider from a token pasted by the player (e.g. `claude setup-token`), never OAuth. */
export const connectAgentToken = async (provider: string, token: string, name: string): Promise<AgentConnection> => {
  const response = await authenticatedFetch(connectionPath(provider), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name }),
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not link this provider.'));
  }

  return (await response.json()) as AgentConnection;
};

export const disconnectAgent = async (id: string): Promise<void> => {
  const response = await authenticatedFetch(`/me/agents/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not disconnect this provider.'));
  }
};

export const renameAgentConnection = async (id: string, name: string): Promise<AgentConnection> => {
  const response = await authenticatedFetch(`/me/agents/connections/${encodeURIComponent(id)}/name`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not rename this account.'));
  return (await response.json()) as AgentConnection;
};

export const fetchEngineDefaults = async (): Promise<EngineDefaults[]> => {
  const response = await authenticatedFetch('/admin/agents/defaults');
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not load engine defaults.'));
  return response.json();
};

export const saveEngineDefaults = async (defaults: EngineDefaults): Promise<EngineDefaults> => {
  const response = await authenticatedFetch(`/admin/agents/${encodeURIComponent(defaults.provider)}/defaults`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(defaults),
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not save engine defaults.'));
  return response.json();
};

export const selectDefaultAccount = async (connectionId: string | null): Promise<AgentConnection[]> => {
  const response = await authenticatedFetch('/me/agents/default-account', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ connectionId }),
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, 'Could not change your default account.'));
  return ((await response.json()) as AgentConnectionsResponse).connections;
};
