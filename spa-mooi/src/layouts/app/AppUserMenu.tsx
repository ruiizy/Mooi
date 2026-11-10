import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { useSignOut } from '@/features/auth/hooks/useSignOut';
import { AppUserMenuAction } from '@/layouts/app/AppUserMenuAction';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';
import { useOnEscape } from '@/shared/hooks/useOnEscape';
import { cn } from '@/shared/utils/cn';
import { useAuthStore } from '@/stores/authStore';

interface AppUserMenuProps {
  /** `full` is the sidebar's name/avatar/email card; `compact` is the mobile top-bar icon. */
  variant?: 'compact' | 'full';
  /** Closes the mobile drawer when the player follows "My Profile" out of it. */
  onNavigate?: () => void;
}

/**
 * The player, and the two ways to leave, from wherever they happen to be.
 *
 * One trigger, two shapes: `full` for the sidebar (opens upward, since the card sits at the foot of
 * the rail) and `compact` for the mobile top bar (opens downward, anchored to the avatar). Both
 * share the same panel, so the account surface cannot drift apart between them.
 */
export const AppUserMenu = ({ variant = 'compact', onNavigate }: AppUserMenuProps) => {
  const player = useAuthStore((state) => state.player);
  const { busy, signOutHere } = useSignOut();
  const [isOpen, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  const handleNavigate = useCallback(() => {
    close();
    onNavigate?.();
  }, [close, onNavigate]);

  useOnClickOutside(containerRef, close, isOpen);
  useOnEscape(() => { close(); containerRef.current?.querySelector('button')?.focus(); }, isOpen);
  useEffect(() => {
    if (isOpen) containerRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [isOpen]);

  if (!player) {
    return null;
  }

  const isFull = variant === 'full';

  return (
    <div ref={containerRef} className="relative">
      {isFull ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="Open the account menu"
          onClick={() => (isOpen ? close() : setOpen(true))}
          className="flex w-full items-center gap-2.5 rounded-control p-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <Avatar src={player.avatarUrl} name={player.username} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{player.username}</span>
            <span className="block truncate text-[11px] text-ink-subtle">{player.email}</span>
          </span>
          {player.role === 'admin' ? (
            <span className="shrink-0 rounded-full border border-brand/25 bg-brand-soft px-1.5 py-px font-mono text-[9px] font-medium tracking-[0.08em] text-brand-strong uppercase">
              Admin
            </span>
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label="Open the account menu"
          onClick={() => (isOpen ? close() : setOpen(true))}
          className={cn(
            'flex h-10 items-center gap-1 rounded-full py-1 pr-1.5 pl-1 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            isOpen ? 'bg-surface-2' : 'hover:bg-surface-2',
          )}
        >
          <Avatar src={player.avatarUrl} name={player.username} size="sm" />
          <ChevronDown
            className={cn('size-4 text-ink-subtle transition duration-200', isOpen && 'rotate-180')}
          />
        </button>
      )}

      {isOpen ? (
        <div
          onKeyDown={(event) => {
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'ArrowDown' ? (index + 1) % items.length
              : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
            if (next !== null) { event.preventDefault(); items[next]?.focus(); }
            if (event.key === 'Tab') close();
          }}
          role="menu"
          aria-label="Account"
          className={cn(
            'absolute z-50 w-[min(17rem,calc(100vw-2rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto animate-menu-in rounded-xl border border-line bg-surface p-1 shadow-pop',
            isFull ? 'bottom-full left-0 mb-2 origin-bottom-left' : 'top-full right-0 mt-2 origin-top-right',
          )}
        >
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar src={player.avatarUrl} name={player.username} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{player.username}</span>
              <span className="block truncate text-xs text-ink-subtle">{player.email}</span>
            </span>
            <Badge tone={player.role === 'admin' ? 'brand' : 'neutral'} className="capitalize">
              {player.role}
            </Badge>
          </div>

          <div className="my-1 border-t border-line" />

          <AppUserMenuAction icon={UserRound} label="My Profile" to={ROUTES.account} onClick={handleNavigate} />

          <div className="my-1 border-t border-line" />

          <AppUserMenuAction icon={LogOut} label="Log Out" tone="danger" disabled={busy} onClick={signOutHere} />
        </div>
      ) : null}
    </div>
  );
};
