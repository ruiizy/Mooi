import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { toneStyles } from '@/shared/styles/toneStyles';
import type { Tone } from '@/shared/types/Tone';
import { cn } from '@/shared/utils/cn';

interface BadgeProps {
  children: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
}

export const Badge = ({ children, tone = 'neutral', icon: Icon, className }: BadgeProps) => (
  <span
    className={cn(
      'inline-flex h-5.5 items-center gap-1.5 rounded-full border px-2 text-[11px] leading-none font-semibold tracking-[0.01em] whitespace-nowrap',
      toneStyles(tone),
      className,
    )}
  >
    {Icon ? <Icon className="size-3" /> : null}
    {children}
  </span>
);
