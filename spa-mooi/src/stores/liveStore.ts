import { create } from 'zustand';
import type { LiveOperationKind } from '@/features/live/types/LiveOperationKind';
import { applyPlatformSnapshot, applyPlatformStreamEvent } from '@/features/platform/lib/applyPlatformStreamEvent';
import type { PlatformEnvironmentVariable } from '@/features/platform/types/PlatformEnvironmentVariable';
import type { PlatformSnapshot } from '@/features/platform/types/PlatformSnapshot';
import type { PlatformStreamState } from '@/features/platform/types/PlatformStreamState';
import type { TodoList } from '@/features/todos/types/TodoList';
import type { LiveState } from '@/stores/types/LiveState';

interface OperationPayload {
  projectId: string;
  snapshot: PlatformSnapshot;
  logs: string[];
}

const KINDS: LiveOperationKind[] = ['production', 'backup'];
const EMPTY: PlatformStreamState<PlatformSnapshot> = { snapshot: null, logs: [] };
const initial = {
  streamState: 'closed' as const,
  synced: false,
  operations: { production: {}, backup: {} },
  configurations: {},
  epoch: 0,
  finished: { production: 0, backup: 0 },
  developmentEnvironments: {},
  todos: {},
};

const bump = (counters: Record<string, number>, ...keys: string[]): Record<string, number> =>
  Object.fromEntries([...Object.entries(counters), ...keys.map((key) => [key, (counters[key] ?? 0) + 1])]);

const byProject = (items: OperationPayload[]): Record<string, PlatformStreamState<PlatformSnapshot>> =>
  Object.fromEntries(items.map((item) => [item.projectId, { snapshot: item.snapshot, logs: item.logs }]));

const ended = (snapshot: PlatformSnapshot | null | undefined): boolean =>
  (snapshot as { state?: string } | null | undefined)?.state === 'succeeded'
  || (snapshot as { state?: string } | null | undefined)?.state === 'failed';

/**
 * Everything live outside session transcripts, folded from the player's channel: each project's
 * production and backup operation with its console, and revisions that tell views when a
 * configuration, an environment or a persisted history changed, whichever side changed it, and
 * each project's to-do list as last read or committed.
 * Session summaries from the same channel go to `sessionsStore`. Not persisted: server state.
 */
export const useLiveStore = create<LiveState>((set) => ({
  ...initial,
  generation: 0,

  setStreamState: (streamState) => set({ streamState }),

  apply: (frame) => set((state) => {
    const data = frame.data as Record<string, unknown>;
    if (frame.type === 'sync') {
      // What changed while disconnected is unknown: a new epoch reloads every view once.
      return {
        synced: true,
        epoch: state.epoch + 1,
        operations: { production: byProject(data.production as OperationPayload[]), backup: byProject(data.backups as OperationPayload[]) },
        finished: { production: state.finished.production + 1, backup: state.finished.backup + 1 },
      };
    }
    const projectId = String(data.projectId ?? '');
    if (frame.type === 'project.todos') {
      return { todos: { ...state.todos, [projectId]: data.todos as TodoList } };
    }
    if (frame.type === 'development.environment') {
      return {
        developmentEnvironments: { ...state.developmentEnvironments, [projectId]: data.environment as PlatformEnvironmentVariable[] },
        configurations: bump(state.configurations, ...KINDS.map((kind) => `${kind}:${projectId}`)),
      };
    }
    const [prefix, action] = frame.type.split('.') as [LiveOperationKind, string];
    if (!KINDS.includes(prefix)) return state;
    if (action === 'configuration') return { configurations: bump(state.configurations, `${prefix}:${projectId}`) };
    const previous = state.operations[prefix][projectId] ?? EMPTY;
    const next = applyPlatformStreamEvent(prefix, previous, frame);
    return {
      operations: { ...state.operations, [prefix]: { ...state.operations[prefix], [projectId]: next } },
      ...(action === 'updated' && ended(next.snapshot) && !ended(previous.snapshot) ? { finished: { ...state.finished, [prefix]: state.finished[prefix] + 1 } } : {}),
    };
  }),

  adoptSnapshot: (kind, projectId, snapshot) => set((state) => ({
    operations: { ...state.operations, [kind]: { ...state.operations[kind],
      [projectId]: applyPlatformSnapshot(state.operations[kind][projectId] ?? EMPTY, snapshot) } },
  })),

  adoptTodos: (projectId, todos) => set((state) => ({ todos: { ...state.todos, [projectId]: todos } })),

  reconnect: () => set((state) => ({ generation: state.generation + 1 })),

  reset: () => set(initial),
}));
