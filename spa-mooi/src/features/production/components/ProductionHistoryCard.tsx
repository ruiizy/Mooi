import { ChevronRight, History, RotateCcw } from 'lucide-react';
import type { ProductionDeployment } from '@/features/production/types/ProductionDeployment';
import { DeploymentStateIcon } from '@/features/production/components/DeploymentStateIcon';
import { Card } from '@/shared/components/Card';
import { formatDuration } from '@/shared/utils/formatDuration';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';

interface ProductionHistoryCardProps {
  deployments: ProductionDeployment[];
  loading: boolean;
  error: string | null;
  canRedeploy: boolean;
  onOpen: (deployment: ProductionDeployment) => void;
  onRedeploy: (deployment: ProductionDeployment) => void;
}

/** Recent attempts, newest first; each opens its detail and can be redeployed as-is. */
export const ProductionHistoryCard = ({ deployments, loading, error, canRedeploy, onOpen, onRedeploy }: ProductionHistoryCardProps) => (
  <Card as="section" className="flex flex-col overflow-hidden">
    <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><History className="size-4 text-ink-subtle" />Deployments</h2>
      <span className="text-xs font-semibold text-ink-subtle tabular-nums">{deployments.length > 0 ? `${deployments.length} recent` : ''}</span>
    </header>
    {error ? <p role="alert" className="px-5 py-4 text-sm text-danger">{error}</p>
      : loading && deployments.length === 0 ? <div className="m-5 h-24 animate-pulse-soft rounded-xl bg-surface-2" />
        : deployments.length === 0 ? <p className="px-5 py-6 text-sm text-ink-muted">Every deployment appears here with its files and output.</p>
          : <ul className="divide-y divide-line">
            {deployments.slice(0, 8).map((deployment) => <li key={deployment.operationId} className="group flex items-center gap-1 pr-3 transition hover:bg-surface-2">
              <button type="button" onClick={() => onOpen(deployment)} aria-label={`View ${deployment.releaseTag} deployment`}
                className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
                <DeploymentStateIcon state={deployment.state} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm font-bold text-ink">{deployment.releaseTag}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {formatRelativeTime(deployment.startedAt)}{deployment.finishedAt ? ` · ${formatDuration(deployment.startedAt, deployment.finishedAt)}` : ' · running'}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5" />
              </button>
              {canRedeploy && deployment.state !== 'running' ? <button type="button" onClick={() => onRedeploy(deployment)}
                aria-label={`Redeploy ${deployment.releaseTag}`} title={`Redeploy ${deployment.releaseTag}`}
                className="grid size-9 shrink-0 place-items-center rounded-control text-ink-subtle transition hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
                <RotateCcw className="size-4" /></button> : null}
            </li>)}
          </ul>}
  </Card>
);
