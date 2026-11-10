import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { backupPath } from '@/app/paths';
import type { Backup } from '@/features/backups/types/Backup';
import { DeploymentStateBadge } from '@/features/production/components/DeploymentStateBadge';
import { DeploymentStateIcon } from '@/features/production/components/DeploymentStateIcon';
import type { Project } from '@/features/projects/types/Project';
import { formatDate } from '@/shared/utils/formatDate';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';
import { formatTime } from '@/shared/utils/formatTime';

interface BackupHistoryListProps {
  backups: Backup[];
  projects: Map<string, Project>;
  onOpen: (backup: Backup) => void;
}

/** Every recorded backup across projects, newest first. */
export const BackupHistoryList = ({ backups, projects, onOpen }: BackupHistoryListProps) => (
  <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
    {backups.map((backup) => {
      const project = projects.get(backup.projectId);
      return <li key={backup.id} className="group flex items-center gap-1 pr-3 transition hover:bg-surface-2">
        <button type="button" onClick={() => onOpen(backup)} aria-label={`View ${project?.name ?? 'project'} backup details`}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:px-5">
          <DeploymentStateIcon state={backup.state} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 truncate text-sm font-semibold text-ink">{project?.name ?? 'Removed project'}
              {backup.verifiedAt ? <ShieldCheck className="size-3.5 shrink-0 text-success" aria-label="Verified" /> : null}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-muted">
              <span className="font-mono font-bold text-ink">{backup.releaseTag}</span> · {formatDate(backup.startedAt)} {formatTime(backup.startedAt)}
              {' · '}{formatRelativeTime(backup.startedAt)}
            </span>
          </span>
          <span className="hidden sm:block"><DeploymentStateBadge state={backup.state} /></span>
        </button>
        {project ? <Link to={backupPath(project.id)} aria-label={`Open ${project.name} backups`} title="Open project backups"
          className="grid size-9 shrink-0 place-items-center rounded-control text-ink-subtle transition hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-brand">
          <ArrowRight className="size-4" /></Link> : null}
      </li>;
    })}
  </ul>
);
