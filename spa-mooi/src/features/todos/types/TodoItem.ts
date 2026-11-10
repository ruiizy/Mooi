import type { TodoStatus } from '@/features/todos/types/TodoStatus';

/** One line of any length: Mooi sets no limit on what an item says. */
export interface TodoItem {
  text: string;
  status: TodoStatus;
}
