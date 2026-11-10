import type { Tone } from '@/shared/types/Tone';

/** A tinted fill plus a faint edge of the same hue: badges read clearly on light and dark surfaces. */
const tones: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-ink-muted',
  brand: 'border-brand/20 bg-brand-soft text-brand-strong',
  success: 'border-success/20 bg-success-soft text-success',
  warning: 'border-warning/20 bg-warning-soft text-warning',
  danger: 'border-danger/20 bg-danger-soft text-danger',
  info: 'border-info/20 bg-info-soft text-info',
  accent: 'border-accent/20 bg-accent-soft text-accent',
};

export const toneStyles = (tone: Tone): string => tones[tone];
