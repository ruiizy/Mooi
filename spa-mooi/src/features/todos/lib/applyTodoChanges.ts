import type { TodoChange } from '@/features/todos/types/TodoChange';
import type { TodoItem } from '@/features/todos/types/TodoItem';
import type { TodoStatus } from '@/features/todos/types/TodoStatus';

const at = (items: TodoItem[], text: string): number => items.findIndex((item) => item.text === text);

/** Lifts `text` out and puts it back next to `anchor`; either one gone leaves the list as it is. */
const move = (items: TodoItem[], text: string, anchor: string, place: 'before' | 'after'): TodoItem[] => {
  const from = at(items, text);
  if (from < 0 || text === anchor || at(items, anchor) < 0) return items;
  const rest = items.filter((_, position) => position !== from);
  const to = at(rest, anchor) + (place === 'after' ? 1 : 0);
  return [...rest.slice(0, to), items[from], ...rest.slice(to)];
};

/**
 * Done items sit at the bottom. An item that crosses that line lands right on it, after the last
 * item still to do: completed, it heads the done items; reopened or restarted, it closes the ones
 * still to do. A change between open and in progress keeps the item where it is.
 */
const setStatus = (items: TodoItem[], index: number, status: TodoStatus): TodoItem[] => {
  const item = { ...items[index], status };
  if ((items[index].status === 'done') === (status === 'done')) {
    return items.map((current, position) => (position === index ? item : current));
  }
  const rest = items.filter((_, position) => position !== index);
  const to = rest.reduce((last, current, position) => (current.status === 'done' ? last : position + 1), 0);
  return [...rest.slice(0, to), item, ...rest.slice(to)];
};

/**
 * Replays pending edits on a list. An edit whose item is gone (removed elsewhere meanwhile) is
 * dropped rather than guessed, and an add never duplicates an item that already arrived. New items
 * go on top, where the composer that adds them sits.
 */
export const applyTodoChanges = (items: TodoItem[], changes: TodoChange[]): TodoItem[] =>
  changes.reduce<TodoItem[]>((list, change) => {
    if (change.kind === 'replace') return change.items.map((item) => ({ ...item }));
    if (change.kind === 'add') return at(list, change.text) >= 0 ? list : [{ text: change.text, status: 'open' }, ...list];
    if (change.kind === 'move') return move(list, change.text, change.anchor, change.place);
    const index = at(list, change.text);
    if (index < 0) return list;
    if (change.kind === 'remove') return list.filter((_, position) => position !== index);
    if (change.kind === 'status') return setStatus(list, index, change.status);
    return list.map((item, position) => (position === index ? { ...item, text: change.next } : item));
  }, items);
