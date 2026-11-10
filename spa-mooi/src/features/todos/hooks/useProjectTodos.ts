import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTodos, saveTodos } from '@/features/todos/api/todosApi';
import { applyTodoChanges } from '@/features/todos/lib/applyTodoChanges';
import { TodosConflictError } from '@/features/todos/lib/TodosConflictError';
import type { TodoChange } from '@/features/todos/types/TodoChange';
import type { TodoItem } from '@/features/todos/types/TodoItem';
import type { TodoList } from '@/features/todos/types/TodoList';
import type { TodoSyncStatus } from '@/features/todos/types/TodoSyncStatus';
import { useLiveStore } from '@/stores/liveStore';

/** Conflicts in a row before giving up: each one means somebody else committed meanwhile. */
const MAX_REPLAYS = 3;

export interface UseProjectTodos {
  /** The file as last read, committed or announced; null until the first read. */
  list: TodoList | null;
  /** What the view shows: the file with the edits still on their way applied on top. */
  items: TodoItem[];
  loadError: string | null;
  saveError: string | null;
  status: TodoSyncStatus;
  /** Queues one edit; it is committed as soon as the previous commit answered. */
  change: (change: TodoChange) => void;
  reload: () => void;
}

/**
 * The project's `docs/TODOS.md`, editable with no wait and no lost change.
 *
 * Edits apply to the view at once and are committed in order, coalesced while a commit is in
 * flight, so a burst of clicks costs a commit or two rather than one each. Every commit names the
 * revision it was built on; when the file moved on meanwhile (another device, an agent, a push),
 * the latest file is read and the pending edits are replayed on it, never written over it.
 *
 * Nothing is read from GitHub until `enabled`: a view listing many projects reads each list only
 * once it is looked at, while live announcements still keep any list already read up to date.
 */
export const useProjectTodos = (projectId: string, enabled = true): UseProjectTodos => {
  const list = useLiveStore((live) => live.todos[projectId] ?? null);
  const epoch = useLiveStore((live) => live.epoch);
  const [pending, setPending] = useState<TodoChange[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloads, setReloads] = useState(0);
  const pendingRef = useRef<TodoChange[]>([]);
  const inFlight = useRef(false);

  const adopt = useCallback((todos: TodoList) => useLiveStore.getState().adoptTodos(projectId, todos), [projectId]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    fetchTodos(projectId)
      .then((todos) => { if (active) { adopt(todos); setLoadError(null); } })
      .catch((failure: Error) => { if (active) setLoadError(failure.message); });
    return () => { active = false; };
  }, [projectId, enabled, epoch, reloads, adopt]);

  const setQueue = (next: TodoChange[]) => {
    pendingRef.current = next;
    setPending(next);
  };

  const flush = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    let replays = 0;
    try {
      while (pendingRef.current.length > 0) {
        const sending = pendingRef.current;
        const base = useLiveStore.getState().todos[projectId];
        // A file Mooi cannot render only ever changes through an explicit clean-up (a `replace`).
        const replacing = sending.some((pending) => pending.kind === 'replace');
        if (!base || (base.state === 'unsupported' && !replacing)) {
          setQueue([]);
          break;
        }
        try {
          const saved = await saveTodos(projectId, {
            revision: base.revision, title: base.title, items: applyTodoChanges(base.items, sending),
          });
          adopt(saved);
          setQueue(pendingRef.current.slice(sending.length));
          setSaveError(null);
          replays = 0;
        } catch (failure) {
          // A clean-up was confirmed against what the player saw; replaying it on a newer file could drop unseen content.
          if (failure instanceof TodosConflictError && !replacing && replays < MAX_REPLAYS) {
            replays += 1;
            adopt(await fetchTodos(projectId));
            continue;
          }
          throw failure;
        }
      }
    } catch (failure) {
      setQueue([]);
      setSaveError(failure instanceof Error ? failure.message : 'Could not save the to-do list.');
      void fetchTodos(projectId).then(adopt).catch(() => undefined);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [projectId, adopt]);

  const change = useCallback((next: TodoChange) => {
    setQueue([...pendingRef.current, next]);
    void flush();
  }, [flush]);

  const items = useMemo(() => applyTodoChanges(list?.items ?? [], pending), [list, pending]);

  return {
    list,
    items,
    loadError,
    saveError,
    status: saving || pending.length > 0 ? 'saving' : saveError ? 'failed' : 'idle',
    change,
    reload: () => setReloads((count) => count + 1),
  };
};
