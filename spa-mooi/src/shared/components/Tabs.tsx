import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { TabItem } from '@/shared/types/TabItem';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}

const FADE = '20px';

/** Fades whichever edge still hides tabs, so a strip wider than a phone reads as scrollable. */
const edgeMask = (start: boolean, end: boolean): string | undefined =>
  start || end
    ? `linear-gradient(to right, ${start ? 'transparent' : '#000'}, #000 ${FADE}, #000 calc(100% - ${FADE}), ${end ? 'transparent' : '#000'})`
    : undefined;

/** The underline grows from the center with `scale`, so switching tabs animates without any layout work. */
export const Tabs = ({ items, value, onChange, ariaLabel, className }: TabsProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      const start = list.scrollLeft > 1;
      const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    update();
    list.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => {
      list.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  const mask = edgeMask(edges.start, edges.end);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={cn('scrollbar-none flex min-w-0 items-center gap-1 overflow-x-auto', className)}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === value;

        const tab = (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              'group/tab relative flex min-h-11 shrink-0 items-center gap-2 rounded-chip px-2.5 text-[13px] font-medium transition-colors duration-150',
              'after:pointer-events-none after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ink after:transition-transform after:duration-200 after:ease-out-expo',
              isActive ? 'text-ink after:scale-x-100' : 'text-ink-muted after:scale-x-0 hover:text-ink',
            )}
          >
            {Icon ? <Icon className={cn('size-4 transition-colors', isActive ? 'text-ink' : 'text-ink-subtle group-hover/tab:text-ink-muted')} /> : null}
            {item.label}
            {typeof item.count === 'number' ? (
              <span
                title={item.count >= 1000 ? item.count.toLocaleString('en') : undefined}
                className={cn(
                  'min-w-5 rounded-full px-1.5 py-px text-center font-mono text-[10.5px] font-medium tabular-nums transition-colors',
                  isActive ? 'bg-contrast text-contrast-ink' : 'bg-surface-3 text-ink-muted',
                )}
              >
                {formatCount(item.count)}
              </span>
            ) : null}
            {item.dot ? (
              <span aria-hidden className="relative flex size-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-success-dot opacity-60" />
                <span className="relative size-1.5 rounded-full bg-success-dot" />
              </span>
            ) : null}
          </button>
        );
        if (!item.onClose) return tab;
        const closeLabel = item.closeLabel ?? `Close ${item.label}`;

        return (
          <div key={item.id} className="flex shrink-0 items-center gap-0.5">
            {tab}
            <button type="button" onClick={item.onClose} aria-label={closeLabel} title={closeLabel}
              className="flex size-6 items-center justify-center rounded-md text-ink-subtle transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
