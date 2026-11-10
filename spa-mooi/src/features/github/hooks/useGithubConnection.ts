import { useCallback } from 'react';
import {
  disconnectGithub,
  fetchGithubConnection,
  startGithubAuthorization,
} from '@/features/github/api/githubApi';
import { useGithubStore } from '@/stores/githubStore';
import type { GithubConnection } from '@/features/github/types/GithubConnection';
import type { GithubConnectionStatus } from '@/features/github/types/GithubConnectionStatus';

interface UseGithubConnection {
  connection: GithubConnection | null;
  status: GithubConnectionStatus;
  error: string | null;
  connect: () => void;
  manageAccess: () => void;
  disconnect: () => void;
  reload: () => void;
}

/**
 * The actions that change the GitHub link, over the state the shell already loaded.
 *
 * It deliberately does not fetch on mount: the connection is application-wide state filled once by
 * `useGithubConnectionSync`, and re-reading it from every card that renders it would turn one fact
 * into several racing answers.
 */
export const useGithubConnection = (): UseGithubConnection => {
  const connection = useGithubStore((state) => state.connection);
  const status = useGithubStore((state) => state.status);
  const error = useGithubStore((state) => state.error);

  /**
   * Leaves the application on purpose: the authorization happens on github.com, and the callback
   * comes back to a route of ours that finishes the exchange.
   */
  const connect = useCallback(() => {
    useGithubStore.getState().setStatus('connecting');
    startGithubAuthorization()
      .then((authorization) => {
        window.location.assign(authorization.authorizeUrl);
      })
      .catch((error: unknown) => {
        useGithubStore.getState().setError(error instanceof Error ? error.message : 'Could not start the GitHub authorization.');
      });
  }, []);

  /**
   * The other half of the link, and the one that actually decides what Mooi can read.
   *
   * Authorizing grants an identity; only an installation grants repositories, which is why a player
   * who sees no private repository is sent here rather than told to authorize again.
   */
  const manageAccess = useCallback(() => {
    useGithubStore.getState().setStatus('connecting');
    startGithubAuthorization()
      .then((authorization) => {
        window.location.assign(authorization.installUrl);
      })
      .catch((error: unknown) => {
        useGithubStore.getState().setError(error instanceof Error ? error.message : 'Could not open your GitHub repository access.');
      });
  }, []);

  const disconnect = useCallback(() => {
    useGithubStore.getState().setStatus('loading');
    disconnectGithub()
      .then(() => {
        useGithubStore.getState().clear();
      })
      .catch(() => {
        useGithubStore.getState().setError('Could not disconnect your GitHub account.');
      });
  }, []);

  const reload = useCallback(() => {
    useGithubStore.getState().setStatus('loading');
    fetchGithubConnection()
      .then((loaded) => {
        useGithubStore.getState().setConnection(loaded);
      })
      .catch(() => {
        useGithubStore.getState().setError('Could not load your GitHub connection.');
      });
  }, []);

  return { connection, status, error, connect, manageAccess, disconnect, reload };
};
