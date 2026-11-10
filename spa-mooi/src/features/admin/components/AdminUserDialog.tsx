import { useEffect, useState, type ReactNode } from 'react';
import { Ban, LogOut, MonitorSmartphone, ShieldCheck, Square, SquareX } from 'lucide-react';
import {
  closeAdminSession, closePlayerSessions, fetchPlayerSignIns, setPlayerBanned, signOutPlayer,
} from '@/features/admin/api/adminApi';
import { deviceLabel } from '@/features/admin/lib/adminActivity';
import type { AdminPlayer } from '@/features/admin/types/AdminPlayer';
import type { AdminSession } from '@/features/admin/types/AdminSession';
import type { AdminSignIn } from '@/features/admin/types/AdminSignIn';
import { sessionDisplayStatus } from '@/features/sessions/lib/sessionDisplayStatus';
import { sessionStatusLabel, sessionStatusPulses, sessionStatusTone } from '@/features/sessions/lib/sessionStatusTone';
import { Avatar } from '@/shared/components/Avatar';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { StatusDot } from '@/shared/components/StatusDot';
import { formatDate } from '@/shared/utils/formatDate';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';

interface AdminUserDialogProps {
  player: AdminPlayer;
  devices: number;
  lastSeenAt: string | null;
  sessions: AdminSession[];
  /** The administrator looking at their own account: no signing out or banning themselves. */
  self: boolean;
  onChange: (change: Partial<AdminPlayer>) => void;
  onClose: () => void;
}

type Action = 'close' | 'signOut' | 'ban' | 'unban' | `session:${string}`;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="mt-6 first:mt-0">
    <h3 className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">{title}</h3>
    {children}
  </section>
);

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 rounded-control border border-line bg-surface-2/50 px-3 py-2">
    <p className="text-[11px] text-ink-subtle">{label}</p>
    <p className="truncate text-sm font-semibold text-ink tabular-nums">{value}</p>
  </div>
);

/**
 * One user in depth: what they are doing now, their devices and the account actions. Live chats
 * follow the administrators' channel, so a closed chat leaves this list on its own.
 */
export const AdminUserDialog = ({ player, devices, lastSeenAt, sessions, self, onChange, onClose }: AdminUserDialogProps) => {
  const [signIns, setSignIns] = useState<AdminSignIn[] | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPlayerSignIns(player.id).then((values) => { if (!cancelled) setSignIns(values); })
      .catch((failure: Error) => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
  }, [player.id]);

  const run = (action: Action, work: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    work().catch((failure: Error) => setError(failure.message)).finally(() => setBusy(null));
  };

  const signedOut = () => {
    setSignIns([]);
    onChange({ signIns: 0 });
  };

  const ban = () => run('ban', async () => {
    const bannedAt = await setPlayerBanned(player.id, true);
    setConfirmBan(false);
    signedOut();
    onChange({ bannedAt });
    // A suspended account keeps no agent running on the platform's accounts.
    if (sessions.length > 0) await closePlayerSessions(player.id);
  });

  const footer = confirmBan ? (
    <>
      <Button variant="ghost" onClick={() => setConfirmBan(false)} disabled={busy !== null}>Cancel</Button>
      <Button variant="danger" onClick={ban} disabled={busy !== null}>
        <Ban className="size-4" /> {busy === 'ban' ? 'Banning…' : `Ban ${player.username}`}
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" disabled={busy !== null || sessions.length === 0}
        onClick={() => run('close', async () => { await closePlayerSessions(player.id); })}>
        <SquareX className="size-4" /> {busy === 'close' ? 'Closing…' : 'Close sessions'}
      </Button>
      <Button variant="secondary" disabled={busy !== null || self || player.signIns === 0}
        onClick={() => run('signOut', async () => { await signOutPlayer(player.id); signedOut(); })}>
        <LogOut className="size-4" /> {busy === 'signOut' ? 'Signing out…' : 'Sign out everywhere'}
      </Button>
      {player.bannedAt ? (
        <Button variant="secondary" disabled={busy !== null}
          onClick={() => run('unban', async () => { onChange({ bannedAt: await setPlayerBanned(player.id, false) }); })}>
          <ShieldCheck className="size-4" /> {busy === 'unban' ? 'Restoring…' : 'Unban'}
        </Button>
      ) : (
        <Button variant="danger" disabled={busy !== null || self} onClick={() => setConfirmBan(true)}>
          <Ban className="size-4" /> Ban
        </Button>
      )}
    </>
  );

  return (
    <Modal open onClose={onClose} title={player.username} description={player.email} size="lg" footer={footer}>
      <div className="flex items-center gap-4">
        <Avatar src={player.avatarUrl} name={player.username} size="lg" />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {devices > 0 ? <Badge tone="success">Online{devices > 1 ? ` · ${devices} devices` : ''}</Badge>
              : <Badge>{lastSeenAt ? `Seen ${formatRelativeTime(lastSeenAt)}` : 'Never seen'}</Badge>}
            {player.role === 'admin' && <Badge tone="accent">Admin</Badge>}
            {player.bannedAt && <Badge tone="danger">Banned {formatRelativeTime(player.bannedAt)}</Badge>}
          </div>
          <p className="text-xs text-ink-subtle">Joined {formatDate(player.createdAt)}</p>
        </div>
      </div>

      {confirmBan && (
        <p role="alert" className="mt-5 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
          Banning signs {player.username} out of every device, closes their sessions and blocks new sign-ins until you unban them.
        </p>
      )}
      {error && <p role="alert" className="mt-5 text-sm text-danger">{error}</p>}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label="Projects" value={String(player.projects)} />
        <Fact label="Agent accounts" value={String(player.agentAccounts)} />
        <Fact label="GitHub" value={player.githubLinked ? 'Linked' : 'Not linked'} />
        <Fact label="Signed-in devices" value={String(signIns?.length ?? player.signIns)} />
      </div>

      <div className="mt-6">
        <Section title={`Live sessions · ${sessions.length}`}>
          {sessions.length === 0 ? <p className="text-sm text-ink-subtle">No live session right now.</p> : (
            <ul className="divide-y divide-line rounded-control border border-line">
              {sessions.map((session) => {
                const display = sessionDisplayStatus(session.status, session.deploymentState);
                const action: Action = `session:${session.id}`;
                return (
                  <li key={session.id} className="flex items-center gap-3 px-3 py-2.5">
                    <StatusDot tone={sessionStatusTone(display)} pulse={sessionStatusPulses(display)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {session.projectFullName}
                        <span className="font-normal text-ink-subtle"> · {session.kind === 'session' ? session.branch : session.kind}</span>
                      </p>
                      <p className="truncate text-xs text-ink-subtle">
                        {session.pending ? 'Waiting for an answer' : sessionStatusLabel(display)}
                        {' · '}{session.providerLabel} {session.adapterLabel} · {session.model}{session.effort ? ` · ${session.effort}` : ''}
                        {' · '}{formatRelativeTime(session.updatedAt)}
                      </p>
                    </div>
                    <button type="button" disabled={busy !== null} aria-label="Close session" title="Close session"
                      onClick={() => run(action, () => closeAdminSession(session.id))}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-50">
                      <Square className={busy === action ? 'size-3.5 animate-pulse' : 'size-3.5'} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Signed-in devices">
          {signIns === null ? <p className="text-sm text-ink-subtle">Loading…</p>
            : signIns.length === 0 ? <p className="text-sm text-ink-subtle">Not signed in anywhere.</p> : (
              <ul className="divide-y divide-line rounded-control border border-line">
                {signIns.map((signIn) => (
                  <li key={signIn.id} className="flex items-center gap-3 px-3 py-2.5">
                    <MonitorSmartphone className="size-4 shrink-0 text-ink-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{deviceLabel(signIn.userAgent)}</p>
                      <p className="truncate text-xs text-ink-subtle">
                        {signIn.ipAddress ?? 'Unknown address'} · signed in {formatDate(signIn.createdAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-muted">{formatRelativeTime(signIn.lastUsedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Section>
      </div>
    </Modal>
  );
};
