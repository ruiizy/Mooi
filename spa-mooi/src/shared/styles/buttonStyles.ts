import type { ButtonSize } from '@/shared/types/ButtonSize';
import type { ButtonVariant } from '@/shared/types/ButtonVariant';
import { cn } from '@/shared/utils/cn';

/** Press feedback is a transform, so it never triggers layout and stays smooth on low-end phones. */
const base =
  'relative inline-flex items-center justify-center gap-2 rounded-control font-semibold tracking-[-0.005em] whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:bg-surface-3 disabled:bg-none disabled:text-ink-subtle disabled:border-transparent disabled:shadow-none';

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5.5 text-[15px]',
};

/** `primary` is the neutral high-contrast action; `brand` carries the identity gradient for the main move of a screen. */
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-contrast text-contrast-ink shadow-raised hover:bg-contrast/88',
  brand: 'bg-brand-gradient text-white shadow-brand inset-shadow-[0_1px_0_rgb(255_255_255/0.2)] hover:brightness-110',
  secondary: 'border border-line bg-surface text-ink shadow-card hover:border-line-strong hover:bg-surface-2',
  ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'border border-danger/30 bg-surface text-danger hover:border-danger/50 hover:bg-danger-soft',
};

export const buttonStyles = (
  variant: ButtonVariant,
  size: ButtonSize = 'md',
  className?: string,
): string => cn(base, sizes[size], variants[variant], className);
