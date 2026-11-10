import { Link } from 'react-router-dom';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { backupPath } from '@/app/paths';
import type { Backup } from '@/features/backups/types/Backup';
import { DeploymentStateBadge } from '@/features/production/components/DeploymentStateBadge';
import type { Project } from '@/features/projects/types/Project';
import { Badge } from '@/shared/components/Badge';
import { Initials } from '@/shared/components/Initials';
import { formatRelativeTime } from '@/shared/utils/formatRelativeTime';

interface BackupProjectCardProps {
  project: Project;
  latest: Backup | undefined;
  count: number;
}

/** A project on the backups landing: its latest backup and outcome, opening its backup view. */
export const BackupProjectCard = ({ project, latest, count }: BackupProjectCardProps) => (
  <Link to={backupPath(project.id)}
    className="group flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:gap-5 sm:p-5">
    <div className="flex items-center gap-3">
      <Initials value={project.name} size="md" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[15px] font-extrabold tracking-[-0.02em] text-ink">{project.name}</h3>
        <p className="mt-0.5 truncate font-mono text-[11px] text-ink-subtle">{project.fullName}</p>
      </div>
      <ArrowUpRight className="size-4 shrink-0 self-start text-ink-subtle transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" />
    </div>
    <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3 sm:pt-4">
      {latest ? latest.state === 'succeeded' && latest.verifiedAt ? <Badge tone="success" icon={ShieldCheck}>Verified</Badge>
        : <DeploymentStateBadge state={latest.state} /> : <Badge>No backups</Badge>}
      <span className="min-w-0 truncate text-right text-xs text-ink-muted">
        {latest ? <><span className="font-mono font-bold text-ink">{latest.releaseTag}</span> · {formatRelativeTime(latest.startedAt)}
          {count > 1 ? ` · ${count}` : ''}</> : 'Set up backups'}
      </span>
    </div>
  </Link>
);
