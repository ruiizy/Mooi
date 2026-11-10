import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { deploymentPath } from '@/app/paths';
import type { Project } from '@/features/projects/types/Project';
import { DeploymentStateBadge } from '@/features/production/components/DeploymentStateBadge';
import { DeploymentStateIcon } from '@/features/production/components/DeploymentStateIcon';
import type { ProductionDeployment } from '@/features/production/types/ProductionDeployment';
import { formatDuration } from '@/shared/utils/formatDuration';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';

interface ProductionHistoryListProps {
  deployments: ProductionDeployment[];
  projects: Map<string, Project>;
  onOpen: (deployment: ProductionDeployment) => void;
}

/** Every recorded deployment across projects, newest first. */
export const ProductionHistoryList = ({ deployments, projects, onOpen }: ProductionHistoryListProps) => (
  <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
    {deployments.map((deployment) => {
      const project = projects.get(deployment.projectId);
      return <li key={deployment.operationId} className="group flex items-center gap-1 pr-3 transition hover:bg-surface-2">
        <button type="button" onClick={() => onOpen(deployment)} aria-label={`View ${deployment.releaseTag} deployment details`}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:px-5">
          <DeploymentStateIcon state={deployment.state} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{project?.name ?? 'Removed project'}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-muted">
              <span className="font-mono font-bold text-ink">{deployment.releaseTag}</span> · {formatRelativeTime(deployment.startedAt)}
              {deployment.finishedAt ? ` · ${formatDuration(deployment.startedAt, deployment.finishedAt)}` : ''}
            </span>
          </span>
          <span className="hidden sm:block"><DeploymentStateBadge state={deployment.state} /></span>
        </button>
        {project ? <Link to={deploymentPath(project.id)} aria-label={`Open ${project.name} deployment`} title="Open project deployment"
          className="grid size-9 shrink-0 place-items-center rounded-control text-ink-subtle transition hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
          <ArrowRight className="size-4" /></Link> : null}
      </li>;
    })}
  </ul>
);
