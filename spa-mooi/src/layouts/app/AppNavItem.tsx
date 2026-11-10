import { NavLink } from 'react-router-dom';
import type { AppNavLink } from '@/shared/types/AppNavLink';
import { cn } from '@/shared/utils/cn';

interface AppNavItemProps {
  link: AppNavLink;
  onNavigate?: () => void;
}

/** The active row is lifted onto a surface with a brand bar at its edge: where you are, at a glance. */
export const AppNavItem = ({ link, onNavigate }: AppNavItemProps) => {
  const Icon = link.icon;

  return (
    <NavLink
      to={link.to}
      end={link.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group/nav relative flex h-9 items-center gap-2.5 rounded-control px-2.5 text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand max-lg:h-11',
          isActive
            ? 'bg-surface text-ink shadow-card ring-1 ring-line'
            : 'text-ink-muted hover:bg-surface/60 hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute top-1/2 -left-3 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-gradient transition-[opacity,transform] duration-200',
              isActive ? 'opacity-100' : 'scale-y-0 opacity-0',
            )}
          />
          <Icon className={cn('size-4 shrink-0 transition-colors', isActive ? 'text-brand' : 'text-ink-subtle group-hover/nav:text-ink-muted')} />
          {link.label}
          {link.adminOnly ? (
            <span className="ml-auto rounded-full border border-line px-1.5 py-px font-mono text-[9px] font-medium tracking-[0.08em] text-ink-subtle uppercase">
              Admin
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
};
