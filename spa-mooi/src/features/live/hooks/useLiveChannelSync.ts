import { useEffect } from 'react';
import { applyLiveEvent } from '@/features/live/lib/applyLiveEvent';
import { openEventStream } from '@/features/sessions/lib/openEventStream';
import { useLiveStore } from '@/stores/liveStore';

/**
 * Keeps the player's live channel open for the whole application shell: every session list,
 * operation console, configuration and environment view follows it, so no screen polls. It opens
 * with a `sync` snapshot and reopens with a fresh one after any interruption.
 */
export const useLiveChannelSync = (): void => {
  const generation = useLiveStore((state) => state.generation);

  useEffect(() => {
    const close = openEventStream({
      path: '/events',
      after: 0,
      onFrame: applyLiveEvent,
      onState: (streamState) => useLiveStore.getState().setStreamState(streamState),
    });
    return () => {
      close();
      useLiveStore.getState().reset();
    };
  }, [generation]);
};
