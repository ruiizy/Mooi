import { useCallback, useState } from 'react';
import {
  connectAgentToken,
  disconnectAgent,
  fetchAgentConnections,
  renameAgentConnection,
  selectDefaultAccount,
  startAgentAuthorization,
} from '@/features/agents/api/agentsApi';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import type { AgentProvider } from '@/features/agents/types/AgentProvider';
import type { AgentsStatus } from '@/features/agents/types/AgentsStatus';
import { useAgentsStore } from '@/stores/agentsStore';

interface UseAgentConnections {
  providers: AgentProvider[];
  connections: AgentConnection[];
  status: AgentsStatus;
  error: string | null;
  busy: boolean;
  actionError: string | null;
  startOauth: (provider: string, name: string) => void;
  connectToken: (provider: string, token: string, name: string) => Promise<boolean>;
  disconnect: (id: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<boolean>;
  setDefaultAccount: (id: string | null) => Promise<boolean>;
  reload: () => void;
  clearActionError: () => void;
}

/**
 * The linked agent providers, plus the actions that change them.
 *
 * Every action carries its own `busy`/`actionError` rather than moving the list into
 * `loading`/`error` (same reasoning as `useProjects`): a provider that fails to link must not blank
 * out the connections already on screen, and the message belongs next to the row that was pressed.
 */
export const useAgentConnections = (): UseAgentConnections => {
  const providers = useAgentsStore((state) => state.providers);
  const connections = useAgentsStore((state) => state.connections);
  const status = useAgentsStore((state) => state.status);
  const error = useAgentsStore((state) => state.error);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Leaves the application on purpose: the authorization happens on the provider's own site, and
   * the callback comes back to a route of ours that finishes the exchange (E4).
   */
  const startOauth = useCallback((provider: string, name: string) => {
    setBusy(true);
    setActionError(null);
    startAgentAuthorization(provider)
      .then((authorization) => {
        const state = new URL(authorization.authorizeUrl).searchParams.get('state');
        if (!state) throw new Error('Could not start the authorization.');
        sessionStorage.setItem(`agent-oauth-name:${state}`, name.trim());
        window.location.assign(authorization.authorizeUrl);
      })
      .catch((failure: Error) => {
        setBusy(false);
        setActionError(failure.message);
      });
  }, []);

  const connectToken = useCallback(async (provider: string, token: string, name: string): Promise<boolean> => {
    setBusy(true);
    setActionError(null);

    try {
      const connection = await connectAgentToken(provider, token, name);

      useAgentsStore.getState().upsertConnection(connection);

      return true;
    } catch (failure) {
      setActionError((failure as Error).message);

      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async (id: string): Promise<boolean> => {
    setBusy(true);
    setActionError(null);

    try {
      await disconnectAgent(id);
      useAgentsStore.getState().removeConnection(id);

      return true;
    } catch (failure) {
      setActionError((failure as Error).message);

      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const rename = useCallback(async (id: string, name: string): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      useAgentsStore.getState().upsertConnection(await renameAgentConnection(id, name));
      return true;
    } catch (failure) {
      setActionError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const setDefaultAccount = useCallback(async (id: string | null): Promise<boolean> => {
    setBusy(true);
    setActionError(null);
    try {
      useAgentsStore.getState().setConnections(await selectDefaultAccount(id));
      return true;
    } catch (failure) {
      setActionError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const reload = useCallback(() => {
    useAgentsStore.getState().setStatus('loading');
    fetchAgentConnections()
      .then((loaded) => {
        useAgentsStore.getState().setConnections(loaded);
      })
      .catch((failure: Error) => {
        useAgentsStore.getState().setError(failure.message);
      });
  }, []);

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    providers,
    connections,
    status,
    error,
    busy,
    actionError,
    startOauth,
    connectToken,
    disconnect,
    rename,
    setDefaultAccount,
    reload,
    clearActionError,
  };
};
