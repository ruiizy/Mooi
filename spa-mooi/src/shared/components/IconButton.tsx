import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  className?: string;
  active?: boolean;
}

export const IconButton = ({
  icon: Icon,
  label,
  onClick,
  className,
  active = false,
}: IconButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={cn(
      'inline-flex size-10 shrink-0 items-center justify-center rounded-control transition-[background-color,color,transform] duration-150 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
      active ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
      className,
    )}
  >
    <Icon className="size-4.5" />
  </button>
);
