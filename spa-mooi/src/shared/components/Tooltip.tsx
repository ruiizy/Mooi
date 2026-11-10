import { useId, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  /** Lets the trigger take focus, so touch and keyboard users can reveal the tooltip too. */
  focusable?: boolean;
  placement?: 'top' | 'bottom';
  /** Which trigger edge the bubble lines up with; `end` keeps it on screen for right-aligned triggers. */
  align?: 'start' | 'end';
  /** Monospace for paths and code; plain text for sentences. */
  mono?: boolean;
}

/** Hover (or keyboard focus) tooltip, never interactive, CSS-only so it also works inside links without nesting interactive elements. */
export const Tooltip = ({ content, children, className, focusable = false, placement = 'bottom', align = 'start', mono = true }: TooltipProps) => {
  const id = useId();
  return (
  <span
    tabIndex={focusable ? 0 : undefined}
    aria-describedby={focusable ? id : undefined}
    className={cn(
      'group/tooltip relative inline-flex max-w-full min-w-0 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
      className,
    )}
  >
    {children}
    <span
      id={id}
      role="tooltip"
      className={cn(placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5', align === 'end' ? 'right-0' : 'left-0',
        mono ? 'font-mono break-all' : 'font-sans font-semibold break-words whitespace-pre-line', "pointer-events-none invisible absolute z-50 w-max max-w-[min(32rem,calc(100vw-2rem))] translate-y-0.5 rounded-chip border border-line-strong bg-surface px-2.5 py-1.5 text-[11px] leading-snug text-ink opacity-0 shadow-pop transition duration-150 group-hover/tooltip:visible group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100 group-focus-visible/tooltip:visible group-focus-visible/tooltip:translate-y-0 group-focus-visible/tooltip:opacity-100")}
    >
      {content}
    </span>
  </span>
  );
};
