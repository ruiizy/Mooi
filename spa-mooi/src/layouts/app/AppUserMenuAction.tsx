import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';

interface AppUserMenuActionProps {
  icon: LucideIcon;
  label: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

const tones = {
  default: 'text-ink hover:bg-surface-2 focus-visible:bg-surface-2 [&>svg]:text-ink-subtle',
  danger: 'text-danger hover:bg-danger-soft',
};

/**
 * One row of the account menu, as a link or as a button.
 *
 * Both shapes render identically on purpose: inside a menu, going somewhere and doing something
 * are the same gesture, and a row that looked different would suggest a difference that is not
 * there for the player.
 */
export const AppUserMenuAction = ({
  icon: Icon,
  label,
  to,
  onClick,
  disabled = false,
  tone = 'default',
}: AppUserMenuActionProps) => {
  const className = cn(
    'flex h-10 w-full items-center gap-2.5 rounded-chip px-2.5 text-left text-[13px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    tones[tone],
    disabled && 'pointer-events-none opacity-55',
  );

  if (to) {
    return (
      <Link to={to} onClick={onClick} role="menuitem" className={className}>
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    );
  }

  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={className}>
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
};
