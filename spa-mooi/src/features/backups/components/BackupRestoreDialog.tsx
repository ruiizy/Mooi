import { useState } from 'react';
import { ArchiveRestore, LoaderCircle } from 'lucide-react';
import type { Backup } from '@/features/backups/types/Backup';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { formatDate } from '@/shared/utils/formatDate';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';
import { formatTime } from '@/shared/utils/formatTime';

interface BackupRestoreDialogProps {
  backup: Backup;
  projectName: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

/** Restoring into production is never implicit: the user reads what it does and confirms it explicitly. */
export const BackupRestoreDialog = ({ backup, projectName, busy, error, onClose, onConfirm }: BackupRestoreDialogProps) => {
  const [understood, setUnderstood] = useState(false);

  return <Modal open onClose={busy ? () => undefined : onClose} title="Restore into production"
    description={`${projectName} · backup of ${formatDate(backup.startedAt)} at ${formatTime(backup.startedAt)}, release ${backup.releaseTag}.`}
    footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="danger" onClick={onConfirm} disabled={busy || !understood}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArchiveRestore className="size-4" />}{busy ? 'Starting…' : 'Restore production'}
      </Button></>}>
    <ul className="flex flex-col gap-2 text-sm leading-relaxed text-ink-muted">
      <li>The production instance is stopped while restore.sh puts this backup back, then started again.</li>
      <li>Everything written after this backup is replaced by its data.</li>
      <li>{backup.verifiedAt ? `It was last verified in a disposable instance ${formatRelativeTime(backup.verifiedAt)}.`
        : 'It has not been verified yet: verifying it first in a disposable instance is safer.'}</li>
    </ul>
    <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-2 p-3.5 text-sm text-ink">
      <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} disabled={busy}
        className="mt-0.5 size-4 accent-danger" />
      <span>I understand production data will be replaced by this backup.</span>
    </label>
    {error ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p> : null}
  </Modal>;
};
