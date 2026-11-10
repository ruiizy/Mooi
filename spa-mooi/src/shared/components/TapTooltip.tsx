import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';
import { useOnEscape } from '@/shared/hooks/useOnEscape';
import { useTransientOpen } from '@/shared/hooks/useTransientOpen';
import { cn } from '@/shared/utils/cn';

interface TapTooltipProps {
  /** Accessible name of the trigger, e.g. "Show session details". */
  label: string;
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** How long the bubble stays after a tap, in ms. */
  duration?: number;
}

/**
 * Touch tooltip: a tap reveals the details, and they leave on their own after a few seconds, on a
 * second tap, a tap elsewhere, scrolling or Escape. Read-only, like a hover tooltip.
 */
export const TapTooltip = ({ label, content, children, className, duration = 4000 }: TapTooltipProps) => {
  const { open, toggle, close } = useTransientOpen(duration);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useOnClickOutside(root, close, open);
  useOnEscape(close, open);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open, close]);

  return (
    <div ref={root} className={cn('relative min-w-0', className)}>
      <button type="button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={toggle}
        className="block w-full min-w-0 rounded-chip text-left transition active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        {children}
      </button>
      {open ? (
        <div id={id} role="tooltip"
          className="absolute top-full left-0 z-50 mt-2 w-max max-w-[calc(100vw-1.5rem)] origin-top-left animate-menu-in rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-ink shadow-pop">
          {content}
        </div>
      ) : null}
    </div>
  );
};
