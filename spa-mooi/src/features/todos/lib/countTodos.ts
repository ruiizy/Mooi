import type { TodoItem } from '@/features/todos/types/TodoItem';
import type { TodoStatus } from '@/features/todos/types/TodoStatus';

export type TodoCounts = Record<TodoStatus, number>;

/** How many items stand at each status. */
export const countTodos = (items: TodoItem[]): TodoCounts => {
  const counts: TodoCounts = { open: 0, inProgress: 0, done: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
};
