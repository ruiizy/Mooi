import { PLATFORM_LOG_LIMIT } from '@/features/platform/lib/platformLogLimit';
import type { PlatformSnapshot } from '@/features/platform/types/PlatformSnapshot';
import type { PlatformStreamState } from '@/features/platform/types/PlatformStreamState';
import type { StreamFrame } from '@/features/sessions/lib/openEventStream';

/** Adopts a snapshot; a different operation starts with an empty console. */
export const applyPlatformSnapshot = <S extends PlatformSnapshot>(state: PlatformStreamState<S>, snapshot: S): PlatformStreamState<S> => ({
  snapshot,
  logs: snapshot.operationId === state.snapshot?.operationId ? state.logs : [],
});

/**
 * The single fold over one project's operation events (`<prefix>.sync|updated|log`): sync replaces,
 * updates adopt, output of the current operation appends. Other events leave the state untouched.
 */
export const applyPlatformStreamEvent = <S extends PlatformSnapshot>(prefix: string, state: PlatformStreamState<S>,
  frame: StreamFrame): PlatformStreamState<S> => {
  const data = frame.data as Record<string, unknown>;
  switch (frame.type) {
    case `${prefix}.sync`:
      return { snapshot: data.snapshot as S, logs: data.logs as string[] };
    case `${prefix}.updated`:
      return applyPlatformSnapshot(state, data.snapshot as S);
    case `${prefix}.log`:
      return data.operationId === state.snapshot?.operationId
        ? { ...state, logs: [...state.logs, ...(data.lines as string[])].slice(-PLATFORM_LOG_LIMIT) } : state;
    default:
      return state;
  }
};
