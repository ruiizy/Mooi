import { useEffect, useState } from 'react';
import { DatabaseBackup, MessagesSquare, Sparkles, Terminal } from 'lucide-react';
import { backupOperationLabel } from '@/features/backups/lib/backupOperationLabel';
import type { BackupSnapshot } from '@/features/backups/types/BackupSnapshot';
import { DeploymentStateBadge } from '@/features/production/components/DeploymentStateBadge';
import { DeployTerminal } from '@/features/sessions/components/deploy/DeployTerminal';
import { Button } from '@/shared/components/Button';
import { formatDuration } from '@/shared/utils/formatDuration';

interface BackupConsolePanelProps {
  snapshot: BackupSnapshot | null;
  logs: string[];
  hasChat: boolean;
  canBackup: boolean;
  onOpenChat: () => void;
  onFix: () => void;
  onBackup: () => void;
}

/** Ticks once a second while an operation runs, so its elapsed time stays live. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
};

/** Live output of the current backup operation, with its outcome and the next step once it ends. */
export const BackupConsolePanel = ({ snapshot, logs, hasChat, canBackup, onOpenChat, onFix, onBackup }: BackupConsolePanelProps) => {
  const running = snapshot?.state === 'running';
  const now = useNow(running);

  if (!snapshot?.operationId || snapshot.state === 'idle') {
    return <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-control bg-surface-2 text-ink-subtle"><Terminal className="size-5" /></span>
      <p className="text-sm font-bold text-ink">No backup output yet</p>
      <p className="max-w-sm text-sm text-ink-muted">Start a backup or a restore to follow its script live. Past output stays in each backup's detail.</p>
    </div>;
  }

  const ended = running ? new Date(now).toISOString() : snapshot.updatedAt;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <DeploymentStateBadge state={snapshot.state} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="font-bold text-ink">{backupOperationLabel(snapshot.action, snapshot.target)}</span>
          {snapshot.releaseTag ? <span className="font-mono font-bold text-ink">{snapshot.releaseTag}</span> : null}
          {snapshot.backupKey ? <span className="truncate font-mono">{snapshot.backupKey}</span> : null}
          {snapshot.startedAt ? <span className="tabular-nums">{formatDuration(snapshot.startedAt, ended)}</span> : null}
          {snapshot.message ? <span className="truncate">{snapshot.message}</span> : null}
        </div>
        {snapshot.state === 'failed' ? <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={hasChat ? onOpenChat : onFix}>
            {hasChat ? <MessagesSquare className="size-4" /> : <Sparkles className="size-4" />}{hasChat ? 'Adjust in chat' : 'Fix with agent'}</Button>
          {canBackup && snapshot.action === 'backup' ? <Button variant="brand" size="sm" onClick={onBackup}><DatabaseBackup className="size-4" />Back up again</Button> : null}
        </div> : null}
      </div>
      <DeployTerminal lines={logs} operationId={snapshot.operationId} label="Backup operation output"
        emptyMessage={snapshot.message ?? 'waiting for the script…'} />
    </div>
  );
};
