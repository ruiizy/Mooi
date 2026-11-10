import { useState } from 'react';
import { Eraser, LoaderCircle, Trash2 } from 'lucide-react';
import type { Backup } from '@/features/backups/types/Backup';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { formatDate } from '@/shared/utils/formatDate';
import { formatTime } from '@/shared/utils/formatTime';

interface BackupDeleteDialogProps {
  backup: Backup;
  /** delete.sh can run: an active configuration exists and nothing else is running. */
  canRunScript: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
  onForget: () => Promise<void>;
}

/** Deleting runs delete.sh against the stored data; forgetting only drops the record, for data already gone. */
export const BackupDeleteDialog = ({ backup, canRunScript, onClose, onDelete, onForget }: BackupDeleteDialogProps) => {
  const [busy, setBusy] = useState<'delete' | 'forget' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'delete' | 'forget') => {
    setBusy(kind); setError(null);
    try { await (kind === 'delete' ? onDelete() : onForget()); }
    catch (failure) { setError((failure as Error).message); setBusy(null); }
  };

  return <Modal open onClose={busy ? () => undefined : onClose} title="Delete backup"
    description={`Backup of ${formatDate(backup.startedAt)} at ${formatTime(backup.startedAt)}, release ${backup.releaseTag}.`}
    footer={<>
      <Button variant="ghost" onClick={() => void run('forget')} disabled={busy !== null} className="sm:mr-auto">
        {busy === 'forget' ? <LoaderCircle className="size-4 animate-spin" /> : <Eraser className="size-4" />}Remove record only</Button>
      <Button variant="ghost" onClick={onClose} disabled={busy !== null}>Cancel</Button>
      <Button variant="danger" onClick={() => void run('delete')} disabled={busy !== null || !canRunScript}>
        {busy === 'delete' ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Delete backup</Button>
    </>}>
    <ul className="flex flex-col gap-2 text-sm leading-relaxed text-ink-muted">
      <li>delete.sh permanently removes the stored data; the record disappears once it succeeds.</li>
      <li>Remove the record only when its data is already gone, e.g. a backup that failed before storing anything.</li>
      {!canRunScript ? <li className="text-danger">delete.sh cannot run now: wait for the running operation, or set up backups again.</li> : null}
    </ul>
    {error ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p> : null}
  </Modal>;
};
