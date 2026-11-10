import { useEffect, useState } from 'react';
import { ArchiveRestore, FlaskConical, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { fetchBackupDetail } from '@/features/backups/api/backupHistoryApi';
import { backupOperationLabel } from '@/features/backups/lib/backupOperationLabel';
import type { Backup } from '@/features/backups/types/Backup';
import type { BackupDetail } from '@/features/backups/types/BackupDetail';
import { DeploymentStateBadge } from '@/features/production/components/DeploymentStateBadge';
import { DeploymentStateIcon } from '@/features/production/components/DeploymentStateIcon';
import { Badge } from '@/shared/components/Badge';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { cn } from '@/shared/utils/cn';
import { formatDate } from '@/shared/utils/formatDate';
import { formatDuration } from '@/shared/utils/formatDuration';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';
import { formatTime } from '@/shared/utils/formatTime';

interface BackupDetailDialogProps {
  backup: Backup;
  projectName: string;
  onClose: () => void;
  onVerify?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}

/** One backup and every operation run on it: what ran, when, how it ended and its redacted output. */
export const BackupDetailDialog = ({ backup, projectName, onClose, onVerify, onRestore, onDelete }: BackupDetailDialogProps) => {
  const [detail, setDetail] = useState<BackupDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'output' | 'script'>('output');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchBackupDetail(backup.projectId, backup.id)
      .then((result) => { if (active) setDetail(result); })
      .catch((failure: Error) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [backup.projectId, backup.id, backup.state, backup.verifiedAt, backup.restoredAt]);

  const operation = detail?.operations.find((item) => item.operation.operationId === selected) ?? detail?.operations[0];
  const content = view === 'script' ? operation?.script ?? '' : operation?.logs.join('\n') || 'No output was recorded.';

  return <Modal open size="lg" onClose={onClose} title={`${formatDate(backup.startedAt)} · ${formatTime(backup.startedAt)} · ${projectName}`}
    description={`Release ${backup.releaseTag}${backup.finishedAt ? ` · took ${formatDuration(backup.startedAt, backup.finishedAt)}` : ''}`}
    footer={onDelete ? <Button variant="ghost" onClick={onDelete} className="text-danger sm:mr-auto"><Trash2 className="size-4" />Delete backup</Button> : undefined}>
    <div className="flex flex-wrap items-center gap-2">
      <DeploymentStateBadge state={backup.state} />
      {backup.verifiedAt ? <Badge tone="success" icon={ShieldCheck}>Verified {formatRelativeTime(backup.verifiedAt)}</Badge> : null}
      {backup.restoredAt ? <Badge tone="info" icon={ArchiveRestore}>Restored {formatRelativeTime(backup.restoredAt)}</Badge> : null}
      <div className="ml-auto flex gap-2">
        {onVerify ? <Button variant="secondary" size="sm" onClick={onVerify}><FlaskConical className="size-4" />Verify</Button> : null}
        {onRestore ? <Button variant="secondary" size="sm" onClick={onRestore}><ArchiveRestore className="size-4" />Restore</Button> : null}
      </div>
    </div>

    {error ? <p role="alert" className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>
      : !detail ? <p className="mt-5 flex items-center gap-2 text-sm text-ink-muted"><LoaderCircle className="size-4 animate-spin" />Loading backup…</p>
        : <div className="mt-5 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <ol aria-label="Operations" className="flex gap-1.5 overflow-x-auto md:flex-col">
            {detail.operations.map(({ operation: item }) => <li key={item.operationId} className="shrink-0">
              <button type="button" onClick={() => setSelected(item.operationId)} aria-pressed={operation?.operation.operationId === item.operationId}
                className={cn('flex w-full min-w-48 items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-brand md:min-w-0',
                  operation?.operation.operationId === item.operationId ? 'border-ink bg-surface' : 'border-line hover:bg-surface-2')}>
                <DeploymentStateIcon state={item.state} className="size-8" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-ink">{backupOperationLabel(item.action, item.target)}</span>
                  <span className="block truncate text-[11px] text-ink-muted">{formatRelativeTime(item.startedAt)}
                    {item.finishedAt ? ` · ${formatDuration(item.startedAt, item.finishedAt)}` : ''}</span>
                </span>
              </button>
            </li>)}
          </ol>
          <div className="min-w-0">
            {operation?.message ? <p className="mb-2 text-sm text-ink-muted">{operation.message}</p> : null}
            <div role="tablist" aria-label="Operation content" className="flex gap-1.5">
              {(['output', 'script'] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => setView(item)}
                className={cn('rounded-lg px-3 py-1.5 font-mono text-xs font-bold transition',
                  view === item ? 'bg-contrast text-contrast-ink' : 'bg-surface-2 text-ink-muted hover:text-ink')}>{item === 'output' ? 'Output' : 'Script'}</button>)}
            </div>
            <pre role="tabpanel" className={cn('mt-3 max-h-[45dvh] overflow-auto rounded-xl p-4 font-mono text-xs leading-6 whitespace-pre-wrap break-all',
              view === 'output' ? 'bg-neutral-950 text-neutral-100' : 'border border-line bg-surface-2 text-ink')}>{content}</pre>
          </div>
        </div>}
  </Modal>;
};
