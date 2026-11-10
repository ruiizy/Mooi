import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';
import { useOnEscape } from '@/shared/hooks/useOnEscape';
import { cn } from '@/shared/utils/cn';

interface ActionsMenuProps {
  label: string;
  /** Receives `dismiss` so an item can close the menu before acting. */
  children: (dismiss: () => void) => ReactNode;
  className?: string;
  /** Attention dot on the trigger, e.g. a failure behind one of the items. */
  indicator?: boolean;
  indicatorClassName?: string;
}

/** Items hidden by a breakpoint (`sm:hidden` wrappers) take no focus. */
const visibleItems = (menu: HTMLElement): HTMLElement[] =>
  Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')).filter((item) => item.getClientRects().length > 0);

/**
 * Secondary actions behind one icon: arrow keys move between items, Escape and outside clicks
 * close it, and the panel scrolls within the viewport when it cannot fit.
 */
export const ActionsMenu = ({ label, children, className, indicator = false, indicatorClassName }: ActionsMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => setOpen(false), []);

  useOnClickOutside(containerRef, dismiss, open);
  useOnEscape(() => {
    dismiss();
    containerRef.current?.querySelector('button')?.focus();
  }, open);
  useEffect(() => {
    const menu = containerRef.current?.querySelector<HTMLElement>('[role="menu"]');
    if (open && menu) visibleItems(menu)[0]?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative flex size-10 items-center justify-center rounded-control transition-[background-color,color,transform] duration-150 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          open ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
          className,
        )}
      >
        <MoreHorizontal className="size-4.5" />
        {indicator ? <span aria-hidden className={cn('absolute top-2 right-2 size-1.5 rounded-full bg-danger-dot', indicatorClassName)} /> : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            const items = visibleItems(event.currentTarget);
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'ArrowDown' ? (index + 1) % items.length
              : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : null;
            if (next !== null) {
              event.preventDefault();
              items[next]?.focus();
            }
            if (event.key === 'Tab') dismiss();
          }}
          className="absolute top-full right-0 z-50 mt-2 max-h-[min(20rem,calc(100dvh-5rem))] w-[min(15rem,calc(100vw-2rem))] origin-top-right overflow-y-auto overscroll-contain animate-menu-in rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {children(dismiss)}
        </div>
      ) : null}
    </div>
  );
};
