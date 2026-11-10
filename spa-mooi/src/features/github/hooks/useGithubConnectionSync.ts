import { useEffect } from 'react';
import { fetchGithubConnection } from '@/features/github/api/githubApi';
import { useGithubStore } from '@/stores/githubStore';

/**
 * Loads the GitHub link once, for the whole application shell.
 *
 * Whether an account is linked decides what every screen may offer, so it is read in one place
 * rather than by each consumer: a single mount fills the store and the rest of the tree reads it.
 * Reading the connection also renews the stored GitHub token server-side, so simply opening the
 * workspace keeps the grant alive.
 */
export const useGithubConnectionSync = (): void => {
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      useGithubStore.getState().setStatus('loading');
      fetchGithubConnection()
        .then((connection) => {
          if (!cancelled) {
            useGithubStore.getState().setConnection(connection);
          }
        })
        .catch(() => {
          if (!cancelled) {
            useGithubStore.getState().setError('Could not load your GitHub connection.');
          }
        });
    };

    // Coming back from github.com with the Back button restores this page from the back/forward
    // cache, frozen mid-redirect: re-read the link so the connect button never stays stuck busy.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        load();
      }
    };

    load();
    window.addEventListener('pageshow', onPageShow);

    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);
};
