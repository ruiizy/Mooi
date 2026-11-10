import type { TodoIssue } from '@/features/todos/types/TodoIssue';
import type { TodoItem } from '@/features/todos/types/TodoItem';
import type { TodoListState } from '@/features/todos/types/TodoListState';

/**
 * The project's `docs/TODOS.md` on its default branch, as last read or committed. The file is the
 * only copy: `revision` is its blob sha, which every save must name.
 */
export interface TodoList {
  path: string;
  state: TodoListState;
  /** Null while the file does not exist; the first save creates it. */
  revision: string | null;
  title: string;
  items: TodoItem[];
  /** Unsupported files only: what is not understood, and what a clean-up keeps. */
  issues: TodoIssue[];
  salvage: TodoItem[];
  content: string | null;
  htmlUrl: string | null;
}
