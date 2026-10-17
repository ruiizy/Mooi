/** Progress of the player-wide session list poll that the app shell keeps running. */
export interface SessionsSyncState {
  loading: boolean;
  error: string | null;
  reload: () => void;
  setSync: (sync: Pick<SessionsSyncState, 'loading' | 'error' | 'reload'>) => void;
}
