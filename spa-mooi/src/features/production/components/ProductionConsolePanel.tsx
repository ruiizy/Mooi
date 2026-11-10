import { useEffect, useState } from 'react';
import { ExternalLink, MessagesSquare, Rocket, Sparkles, Terminal } from 'lucide-react';
import { DeploymentStateBadge } from '@/features/production/components/DeploymentStateBadge';
import type { ProductionSnapshot } from '@/features/production/types/ProductionSnapshot';
import { DeployTerminal } from '@/features/sessions/components/deploy/DeployTerminal';
import { Button } from '@/shared/components/Button';
import { formatDuration } from '@/shared/utils/formatDuration';
import { shortCommit } from '@/shared/utils/shortCommit';

interface ProductionConsolePanelProps {
  snapshot: ProductionSnapshot | null;
  logs: string[];
  hasChat: boolean;
  onOpenChat: () => void;
  onFix: () => void;
  onDeploy: () => void;
}

/** Ticks once a second while a deployment runs, so its elapsed time stays live. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
};

/** Live output of the current deployment, with its outcome and the next step once it ends. */
export const ProductionConsolePanel = ({ snapshot, logs, hasChat, onOpenChat, onFix, onDeploy }: ProductionConsolePanelProps) => {
  const running = snapshot?.state === 'running';
  const now = useNow(running);

  if (!snapshot?.operationId || snapshot.state === 'idle') {
    return <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-control bg-surface-2 text-ink-subtle"><Terminal className="size-5" /></span>
      <p className="text-sm font-bold text-ink">No deployment output yet</p>
      <p className="max-w-sm text-sm text-ink-muted">Start a deployment to follow deploy.sh live. Past output stays available in each deployment's detail.</p>
    </div>;
  }

  const ended = snapshot.state === 'running' ? new Date(now).toISOString() : snapshot.updatedAt;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-5">
        <DeploymentStateBadge state={snapshot.state} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {snapshot.releaseUrl && snapshot.releaseTag ? <a href={snapshot.releaseUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono font-bold text-ink hover:underline">{snapshot.releaseTag}<ExternalLink className="size-3" /></a> : null}
          {snapshot.releaseCommit ? <span className="font-mono">{shortCommit(snapshot.releaseCommit)}</span> : null}
          {snapshot.startedAt ? <span className="tabular-nums">{formatDuration(snapshot.startedAt, ended)}</span> : null}
          {snapshot.message ? <span className="truncate">{snapshot.message}</span> : null}
        </div>
        {snapshot.state === 'failed' ? <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={hasChat ? onOpenChat : onFix}>
            {hasChat ? <MessagesSquare className="size-4" /> : <Sparkles className="size-4" />}{hasChat ? 'Adjust in chat' : 'Fix with agent'}</Button>
          <Button variant="brand" size="sm" onClick={onDeploy}><Rocket className="size-4" />Deploy again</Button>
        </div> : null}
      </div>
      <DeployTerminal lines={logs} operationId={snapshot.operationId} label="Production deployment output"
        emptyMessage={snapshot.message ?? 'waiting for deploy.sh…'} />
    </div>
  );
};
