import { useCallback } from 'react';
import type { LiveOperationKind } from '@/features/live/types/LiveOperationKind';
import type { PlatformSnapshot } from '@/features/platform/types/PlatformSnapshot';
import type { PlatformStreamState } from '@/features/platform/types/PlatformStreamState';
import type { EventStreamState } from '@/features/sessions/lib/openEventStream';
import { useLiveStore } from '@/stores/liveStore';

interface UsePlatformOperation<S> extends PlatformStreamState<S> {
  streamState: EventStreamState;
  /** Changes whenever the configuration, an environment it reads or the channel's epoch changes. */
  configurationRevision: number;
  adoptSnapshot: (snapshot: S) => void;
}

/** One project's live production or backup operation and its console, from the player's channel. */
export const usePlatformOperation = <S extends PlatformSnapshot>(projectId: string | undefined, kind: LiveOperationKind): UsePlatformOperation<S> => {
  const operation = useLiveStore((state) => (projectId ? state.operations[kind][projectId] : undefined));
  const streamState = useLiveStore((state) => state.streamState);
  const configurationRevision = useLiveStore((state) => state.epoch + (projectId ? state.configurations[`${kind}:${projectId}`] ?? 0 : 0));
  const adoptSnapshot = useCallback((snapshot: S) => {
    if (projectId) useLiveStore.getState().adoptSnapshot(kind, projectId, snapshot);
  }, [projectId, kind]);

  return { snapshot: (operation?.snapshot as S | undefined) ?? null, logs: operation?.logs ?? [], streamState, configurationRevision, adoptSnapshot };
};
