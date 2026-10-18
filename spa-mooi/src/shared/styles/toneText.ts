import type { Tone } from '@/shared/types/Tone';

const tones: Record<Tone, string> = {
  neutral: 'text-ink-subtle',
  brand: 'text-brand-strong',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  accent: 'text-accent',
};

/** Text colour alone, for a status written inline rather than as a pill. */
export const toneText = (tone: Tone): string => tones[tone];
