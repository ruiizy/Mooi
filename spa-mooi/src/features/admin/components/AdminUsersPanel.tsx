import { useMemo, useState } from 'react';
import { Activity, Bot, MessagesSquare, RefreshCw, Users } from 'lucide-react';
import { AdminUserDialog } from '@/features/admin/components/AdminUserDialog';
import { AdminUserRow } from '@/features/admin/components/AdminUserRow';
import { useAdminLive } from '@/features/admin/hooks/useAdminLive';
import { useAdminPlayers } from '@/features/admin/hooks/useAdminPlayers';
import { isWorking, lastSeen } from '@/features/admin/lib/adminActivity';
import type { AdminSession } from '@/features/admin/types/AdminSession';
import { WorkspaceStat } from '@/features/sessions/components/workspaces/WorkspaceStat';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatusDot } from '@/shared/components/StatusDot';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/shared/utils/cn';
import { formatCount } from '@/shared/utils/formatCount';

/**
 * Every registered user, the connected ones first, with what they are doing right now. The
 * directory pages through mic-mooi; presence and live sessions stream from mic-sessions.
 */
export const AdminUsersPanel = () => {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const selfId = useAuthStore((state) => state.player?.id);
  const directory = useAdminPlayers(query);
  const live = useAdminLive();

  const sessionsByPlayer = useMemo(() => {
    const grouped = new Map<string, AdminSession[]>();
    for (const session of Object.values(live.sessions)) {
      const list = grouped.get(session.playerId);
      if (list) list.push(session);
      else grouped.set(session.playerId, [session]);
    }
    for (const list of grouped.values()) list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return grouped;
  }, [live.sessions]);

  // Connected users first; otherwise the directory's own order (most recently active first).
  const players = useMemo(() => {
    const online = (id: string) => (live.presence[id] ?? 0) > 0;
    return [...directory.players].sort((a, b) => Number(online(b.id)) - Number(online(a.id)));
  }, [directory.players, live.presence]);

  const sessions = Object.values(live.sessions);
  const online = Object.keys(live.presence).length;
  const working = sessions.filter(isWorking).length;
  const waiting = sessions.filter((session) => session.pending || session.status === 'waiting').length;
  const openPlayer = openId ? directory.players.find((player) => player.id === openId) : undefined;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WorkspaceStat icon={Users} label="Users" value={formatCount(directory.total)} />
        <WorkspaceStat icon={Activity} label="Online now" value={formatCount(online)} />
        <WorkspaceStat icon={MessagesSquare} label="Live sessions" value={formatCount(sessions.length)}
          hint={waiting > 0 ? `${waiting} waiting for an answer` : undefined} />
        <WorkspaceStat icon={Bot} label="Agents working" value={formatCount(working)} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line p-3 sm:px-5">
          <SearchInput value={query} onChange={setQuery} placeholder="Search by name or email" className="shadow-none" />
          <span className="hidden shrink-0 items-center gap-2 px-2 text-xs text-ink-subtle sm:flex"
            title={live.streamState === 'open' ? 'Live' : 'Reconnecting'}>
            <StatusDot tone={live.streamState === 'open' ? 'success' : 'warning'} pulse={live.streamState === 'open'} />
            {live.streamState === 'open' ? 'Live' : 'Reconnecting'}
          </span>
          <button type="button" onClick={directory.reload} title="Reload users" aria-label="Reload users"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-2 hover:text-ink">
            <RefreshCw className={cn('size-4', directory.loading && 'animate-spin')} />
          </button>
        </div>

        {directory.error && <p role="alert" className="px-5 py-4 text-sm text-danger">{directory.error}</p>}
        {!directory.loading && !directory.error && players.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-ink-subtle">{query ? 'No user matches this search.' : 'No users yet.'}</p>
        )}

        <ul className={cn('divide-y divide-line transition-opacity', directory.loading && players.length > 0 && 'opacity-60')}>
          {players.map((player) => {
            const own = sessionsByPlayer.get(player.id) ?? [];
            return (
              <AdminUserRow
                key={player.id}
                player={player}
                devices={live.presence[player.id] ?? 0}
                lastSeenAt={lastSeen(player, live.offlineAt[player.id])}
                sessions={own.length}
                working={own.filter(isWorking).length}
                onOpen={() => setOpenId(player.id)}
              />
            );
          })}
        </ul>

        {directory.hasMore && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" size="sm" disabled={directory.loadingMore} onClick={directory.loadMore}>
              {directory.loadingMore ? 'Loading…' : `Show more (${formatCount(directory.total - directory.players.length)} left)`}
            </Button>
          </div>
        )}
      </Card>

      {openPlayer && (
        <AdminUserDialog
          key={openPlayer.id}
          player={openPlayer}
          devices={live.presence[openPlayer.id] ?? 0}
          lastSeenAt={lastSeen(openPlayer, live.offlineAt[openPlayer.id])}
          sessions={sessionsByPlayer.get(openPlayer.id) ?? []}
          self={openPlayer.id === selfId}
          onChange={(change) => directory.patch(openPlayer.id, change)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
};
