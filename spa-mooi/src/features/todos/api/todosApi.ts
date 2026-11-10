import { TodosConflictError } from '@/features/todos/lib/TodosConflictError';
import type { TodoItem } from '@/features/todos/types/TodoItem';
import type { TodoList } from '@/features/todos/types/TodoList';
import { sessionsFetch } from '@/features/sessions/lib/sessionsFetch';
import { apiErrorMessage } from '@/shared/utils/apiErrorMessage';

interface SaveTodosRequest {
  revision: string | null;
  title: string;
  items: TodoItem[];
}

const todosPath = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}/todos`;

const read = async (response: Response, fallback: string): Promise<TodoList> => {
  if (response.status === 409) throw new TodosConflictError(await apiErrorMessage(response, fallback));
  if (!response.ok) throw new Error(await apiErrorMessage(response, fallback));
  return (await response.json()) as TodoList;
};

/** Through mic-sessions, which announces every commit live to the player's other views and agents. */
export const fetchTodos = async (projectId: string): Promise<TodoList> =>
  read(await sessionsFetch(todosPath(projectId)), 'Could not load the to-do list.');

/** Commits the whole list to `docs/TODOS.md` on the default branch; a stale revision throws `TodosConflictError`. */
export const saveTodos = async (projectId: string, request: SaveTodosRequest): Promise<TodoList> =>
  read(await sessionsFetch(todosPath(projectId), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }), 'Could not save the to-do list.');
