import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

export const Eyebrow = ({ children, className }: EyebrowProps) => (
  <p className={cn('font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase', className)}>
    {children}
  </p>
);
