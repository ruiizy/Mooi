import { ChevronRight } from 'lucide-react';
import type { AdminPlayer } from '@/features/admin/types/AdminPlayer';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { StatusDot } from '@/shared/components/StatusDot';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';

interface AdminUserRowProps {
  player: AdminPlayer;
  devices: number;
  lastSeenAt: string | null;
  sessions: number;
  working: number;
  onOpen: () => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const AdminUserRow = ({ player, devices, lastSeenAt, sessions, working, onOpen }: AdminUserRowProps) => (
  <li>
    <button type="button" onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2 focus-visible:outline-none sm:px-5">
      <span className="relative shrink-0">
        <Avatar src={player.avatarUrl} name={player.username} />
        {devices > 0 && (
          <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-success-dot" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{player.username}</span>
          {player.role === 'admin' && <Badge tone="accent">Admin</Badge>}
          {player.bannedAt && <Badge tone="danger">Banned</Badge>}
        </span>
        <span className="block truncate text-xs text-ink-subtle">{player.email}</span>
        {sessions > 0 && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-muted sm:hidden">
            {plural(sessions, 'session')}{working > 0 ? ` · ${working} working` : ''}
          </span>
        )}
      </span>

      <span className="hidden w-36 shrink-0 text-xs sm:block">
        {sessions > 0 ? (
          <span className="flex items-center gap-2 text-ink-muted">
            <StatusDot tone={working > 0 ? 'info' : 'success'} pulse={working > 0} />
            {plural(sessions, 'session')}{working > 0 ? ` · ${working} working` : ''}
          </span>
        ) : <span className="text-ink-subtle">No live sessions</span>}
      </span>

      <span className="hidden w-20 shrink-0 text-right text-xs text-ink-muted tabular-nums md:block">
        {plural(player.projects, 'project')}
      </span>

      <span className="w-28 shrink-0 text-right text-xs sm:w-36">
        {devices > 0 ? (
          <span className="font-medium text-success">Online{devices > 1 ? ` · ${devices} devices` : ''}</span>
        ) : (
          <span className="text-ink-subtle">{lastSeenAt ? formatRelativeTime(lastSeenAt) : 'Never'}</span>
        )}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-subtle" />
    </button>
  </li>
);
