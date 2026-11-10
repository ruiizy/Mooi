import type { TodoItem } from '@/features/todos/types/TodoItem';
import type { TodoStatus } from '@/features/todos/types/TodoStatus';

/**
 * One edit made in the view, addressed by text rather than position so it can be replayed on a
 * newer list (another device, an agent) without touching the wrong item. A `move` names the item
 * it lands next to for the same reason: an index would point elsewhere once the list moved on.
 */
export type TodoChange =
  | { kind: 'add'; text: string }
  | { kind: 'status'; text: string; status: TodoStatus }
  | { kind: 'edit'; text: string; next: string }
  | { kind: 'move'; text: string; anchor: string; place: 'before' | 'after' }
  | { kind: 'remove'; text: string }
  | { kind: 'replace'; items: TodoItem[] };
