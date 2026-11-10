import { useLiveStore } from '@/stores/liveStore';

interface UseLiveStatus {
  /** No snapshot yet: lists may still be empty for that reason alone. */
  loading: boolean;
  error: string | null;
  reconnect: () => void;
}

/** Whether the player's live channel has delivered its snapshot, for screens that list its data. */
export const useLiveStatus = (): UseLiveStatus => {
  const synced = useLiveStore((state) => state.synced);
  const streamState = useLiveStore((state) => state.streamState);
  return {
    loading: !synced,
    error: streamState === 'reconnecting' && !synced ? 'Could not reach the live updates. Retrying…' : null,
    reconnect: useLiveStore.getState().reconnect,
  };
};
