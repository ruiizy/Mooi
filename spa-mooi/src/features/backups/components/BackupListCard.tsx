import { DatabaseBackup, LoaderCircle } from 'lucide-react';
import { BackupRow } from '@/features/backups/components/BackupRow';
import type { Backup } from '@/features/backups/types/Backup';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';

interface BackupListCardProps {
  backups: Backup[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  deployedRelease: string | null;
  locked: boolean;
  onLoadMore: () => void;
  onOpen: (backup: Backup) => void;
  onVerify: (backup: Backup) => void;
  onRestore: (backup: Backup) => void;
  onDelete: (backup: Backup) => void;
}

/** Every backup of the project, newest first: dated, tied to its release and ready to verify, restore or delete. */
export const BackupListCard = ({ backups, loading, error, hasMore, deployedRelease, locked, onLoadMore, ...actions }: BackupListCardProps) => (
  <Card as="section" className="flex flex-col overflow-hidden">
    <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><DatabaseBackup className="size-4 text-ink-subtle" />Backups</h2>
      <span className="text-xs font-semibold text-ink-subtle tabular-nums">{backups.length > 0 ? `${backups.length}${hasMore ? '+' : ''}` : ''}</span>
    </header>
    {error ? <p role="alert" className="px-5 py-4 text-sm text-danger">{error}</p>
      : loading && backups.length === 0 ? <div className="m-5 h-24 animate-pulse-soft rounded-xl bg-surface-2" />
        : backups.length === 0 ? <p className="px-5 py-6 text-sm text-ink-muted">Every backup appears here with its date, time and release.</p>
          : <ul className="divide-y divide-line">
            {backups.map((backup) => <BackupRow key={backup.id} backup={backup} deployedRelease={deployedRelease} locked={locked} {...actions} />)}
          </ul>}
    {hasMore ? <div className="border-t border-line p-3 text-center">
      <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loading}>
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}Load older backups</Button>
    </div> : null}
  </Card>
);
