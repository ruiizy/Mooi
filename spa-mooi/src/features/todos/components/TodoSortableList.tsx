import { useMemo } from 'react';
import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TodoRow } from '@/features/todos/components/TodoRow';
import type { TodoChange } from '@/features/todos/types/TodoChange';
import type { TodoItem } from '@/features/todos/types/TodoItem';

interface TodoSortableListProps {
  /** The items shown, possibly filtered: a drop lands next to the item it was dropped on. */
  items: TodoItem[];
  /** Every text on the list, filtered out or not. */
  texts: string[];
  locked: boolean;
  change: (change: TodoChange) => void;
}

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

/**
 * The list, reordered by dragging an item's grip. A drop becomes one `move` change that names its
 * neighbour, so it reads the same on the full list behind a filter and replays on a newer file.
 */
export const TodoSortableList = ({ items, texts, locked, change }: TodoSortableListProps) => {
  const sensors = useSensors(
    // The grip has `touch-action: none`, so one pointer sensor serves mouse, pen and touch alike.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Texts are unique once Mooi edits the file; a hand-written copy may still repeat one.
  const ids = useMemo(() => {
    const seen = new Map<string, number>();
    return items.map((item) => {
      const count = seen.get(item.text) ?? 0;
      seen.set(item.text, count + 1);
      return `${item.text}:${count}`;
    });
  }, [items]);

  const drop = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    change({ kind: 'move', text: items[from].text, anchor: items[to].text, place: from < to ? 'after' : 'before' });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={MODIFIERS} onDragEnd={drop}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="relative divide-y divide-line border-t border-line">
          {items.map((item, index) => (
            <TodoRow
              key={ids[index]}
              id={ids[index]}
              item={item}
              locked={locked}
              taken={(text) => texts.includes(text)}
              onStatus={(status) => change({ kind: 'status', text: item.text, status })}
              onEdit={(next) => change({ kind: 'edit', text: item.text, next })}
              onRemove={() => change({ kind: 'remove', text: item.text })}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};
