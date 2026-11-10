import { ArchiveRestore, ChevronRight, FlaskConical, ShieldCheck, Trash2 } from 'lucide-react';
import type { Backup } from '@/features/backups/types/Backup';
import { DeploymentStateIcon } from '@/features/production/components/DeploymentStateIcon';
import { formatDate } from '@/shared/utils/formatDate';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';
import { formatTime } from '@/shared/utils/formatTime';

interface BackupRowProps {
  backup: Backup;
  deployedRelease: string | null;
  /** Another operation runs or the configuration is not active: actions wait. */
  locked: boolean;
  onOpen: (backup: Backup) => void;
  onVerify: (backup: Backup) => void;
  onRestore: (backup: Backup) => void;
  onDelete: (backup: Backup) => void;
}

const rowAction = 'grid size-9 shrink-0 place-items-center rounded-control text-ink-subtle transition hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-40';

/** One backup: when, which release and whether it was proven, with its three actions as distinct icons. */
export const BackupRow = ({ backup, deployedRelease, locked, onOpen, onVerify, onRestore, onDelete }: BackupRowProps) => {
  const usable = backup.state === 'succeeded';
  const matches = backup.releaseTag === deployedRelease;
  const restoreTitle = !usable ? 'Only a successful backup can be restored'
    : !matches ? `Production runs ${deployedRelease ?? 'no release'}; deploy ${backup.releaseTag} to restore this backup` : 'Restore into production';

  return (
    <li className="group flex items-center gap-1 pr-2 transition hover:bg-surface-2 sm:pr-3">
      <button type="button" onClick={() => onOpen(backup)} aria-label={`View backup of ${formatDate(backup.startedAt)} ${formatTime(backup.startedAt)}`}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:px-5">
        <DeploymentStateIcon state={backup.state} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-bold text-ink tabular-nums">{formatDate(backup.startedAt)} · {formatTime(backup.startedAt)}</span>
            {backup.verifiedAt ? <ShieldCheck className="size-3.5 shrink-0 text-success" aria-label="Verified" /> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">
            <span className={matches ? 'font-mono font-bold text-ink' : 'font-mono font-bold text-ink-subtle'}>{backup.releaseTag}</span>
            {' · '}{backup.state === 'running' ? 'running' : formatRelativeTime(backup.startedAt)}
            {backup.restoredAt ? ` · restored ${formatRelativeTime(backup.restoredAt)}` : ''}
          </span>
        </span>
        <ChevronRight className="hidden size-4 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5 sm:block" />
      </button>
      <button type="button" onClick={() => onVerify(backup)} disabled={locked || !usable} className={rowAction}
        aria-label="Verify in a disposable instance" title="Verify in a disposable instance"><FlaskConical className="size-4" /></button>
      <button type="button" onClick={() => onRestore(backup)} disabled={locked || !usable || !matches} className={rowAction}
        aria-label={restoreTitle} title={restoreTitle}><ArchiveRestore className="size-4" /></button>
      <button type="button" onClick={() => onDelete(backup)} disabled={locked || backup.state === 'running'}
        className={`${rowAction} hover:bg-danger-soft hover:text-danger`} aria-label="Delete backup" title="Delete backup"><Trash2 className="size-4" /></button>
    </li>
  );
};
