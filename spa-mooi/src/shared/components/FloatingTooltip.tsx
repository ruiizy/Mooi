import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOnEscape } from '@/shared/hooks/useOnEscape';
import { cn } from '@/shared/utils/cn';

interface FloatingTooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** How long the bubble stays after a touch, in ms. */
  touchDuration?: number;
}

interface Position {
  top: number;
  left: number;
}

const GAP = 6;
const MARGIN = 8;

/**
 * Read-only tooltip portaled to the body with fixed coordinates, so scroll containers never clip it:
 * it shows on mouse hover and keyboard focus, and for a few seconds after a touch. It sits below the
 * trigger (above when there is no room) and is clamped inside the viewport.
 */
export const FloatingTooltip = ({ content, children, className, touchDuration = 3000 }: FloatingTooltipProps) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  const id = useId();

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPosition(null);
  }, []);

  const show = useCallback(() => setOpen(true), []);

  const showTemporarily = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(true);
    timer.current = window.setTimeout(close, touchDuration);
  }, [close, touchDuration]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useOnEscape(close, open);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      const tip = bubble.current?.getBoundingClientRect();
      if (!trigger || !tip) return;
      const fitsBelow = trigger.bottom + GAP + tip.height <= window.innerHeight - MARGIN;
      const top = fitsBelow ? trigger.bottom + GAP : Math.max(MARGIN, trigger.top - GAP - tip.height);
      const left = Math.min(Math.max(MARGIN, trigger.left), Math.max(MARGIN, window.innerWidth - tip.width - MARGIN));
      setPosition((current) => (current && current.top === top && current.left === left ? current : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, close]);

  return (
    <div
      ref={anchor}
      className={cn('min-w-0', className)}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(event) => (event.pointerType === 'mouse' ? show() : undefined)}
      onPointerLeave={(event) => (event.pointerType === 'mouse' ? close() : undefined)}
      onPointerDown={(event) => (event.pointerType === 'mouse' ? undefined : showTemporarily())}
      onFocus={(event) => (event.target.matches(':focus-visible') ? show() : undefined)}
      onBlur={close}
    >
      {children}
      {open
        ? createPortal(
            <div
              ref={bubble}
              id={id}
              role="tooltip"
              style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
              className="pointer-events-none fixed z-[100] w-max max-w-[calc(100vw-1rem)] rounded-chip border border-line-strong bg-surface px-2.5 py-1.5 font-mono text-[11px] leading-snug break-all text-ink shadow-pop"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
