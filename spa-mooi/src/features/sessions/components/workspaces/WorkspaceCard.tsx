import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, GitBranch, GitCommitHorizontal } from 'lucide-react';
import { sessionPath } from '@/app/paths';
import { SessionStatusBadge } from '@/features/sessions/components/SessionStatusBadge';
import type { ProjectWorkspace } from '@/features/sessions/types/ProjectWorkspace';
import { previewUrl } from '@/features/sessions/lib/previewUrl';
import { CopyButton } from '@/shared/components/CopyButton';
import { Tooltip } from '@/shared/components/Tooltip';
import { formatBytes } from '@/shared/utils/formatBytes';
import { formatDate } from '@/shared/utils/formatDate';
import { formatTime } from '@/shared/utils/formatTime';
import { shortCommit } from '@/shared/utils/shortCommit';
import { shortenPath } from '@/shared/utils/shortenPath';

interface WorkspaceCardProps {
  projectId: string;
  workspace: ProjectWorkspace;
  previewsEnabled: boolean;
}

export const WorkspaceCard = ({ projectId, workspace, previewsEnabled }: WorkspaceCardProps) => {
  const advanced = workspace.headCommit !== null && workspace.headCommit !== workspace.baseCommit;
  const drifted = workspace.headBranch !== null && workspace.headBranch !== workspace.branch;
  const preview = previewUrl(workspace.previewUrl);

  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={sessionPath(projectId, workspace.sessionId)}
            className="group inline-flex max-w-full items-center gap-1.5 rounded text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <GitBranch className="size-3.5 shrink-0 text-ink-subtle" />
            <span className="truncate font-mono">{workspace.branch}</span>
            <ArrowRight className="size-3.5 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-ink" />
          </Link>
          <p className="mt-0.5 text-[11px] text-ink-subtle">
            Cloned {formatDate(workspace.createdAt)} · {formatTime(workspace.createdAt)}
          </p>
        </div>
        <span className="w-[108px] shrink-0">
          <SessionStatusBadge status={workspace.status} deployment={workspace.deploymentState} />
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1 rounded-control bg-surface-2 py-1 pr-1 pl-3">
        {workspace.path ? (
          <>
            <Tooltip content={workspace.path} focusable className="flex-1">
              <span className="truncate font-mono text-[11px] text-ink-muted">{shortenPath(workspace.path)}</span>
            </Tooltip>
            <CopyButton value={workspace.path} label="Copy clone path" />
          </>
        ) : (
          <span className="py-1.5 text-[11px] text-ink-subtle italic">Clone not ready yet</span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px] sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Base</dt>
          <dd className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-ink">
            <GitBranch className="size-3 shrink-0 text-ink-subtle" />
            <span className="truncate" title={workspace.baseBranch}>{workspace.baseBranch || '—'}</span>
          </dd>
          {drifted ? (
            <dd className="mt-0.5 truncate font-mono text-[10.5px] text-warning">checked out {workspace.headBranch}</dd>
          ) : (
            <dd className="mt-0.5 truncate text-[10.5px] text-ink-subtle">branched from</dd>
          )}
        </div>

        <div className="min-w-0">
          <dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Commit</dt>
          <dd className="mt-0.5 flex items-center gap-1 font-mono text-ink">
            <GitCommitHorizontal className="size-3 shrink-0 text-ink-subtle" />
            {shortCommit(workspace.headCommit)}
          </dd>
          <dd className="mt-0.5 truncate font-mono text-[10.5px] text-ink-subtle">
            {advanced ? `base ${shortCommit(workspace.baseCommit)}` : 'at base'}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Changes</dt>
          <dd className="mt-0.5 font-extrabold text-ink tabular-nums">{workspace.dirtyFiles}</dd>
          <dd className="mt-0.5 text-[10.5px] text-ink-subtle">
            {workspace.dirtyFiles === 0 ? 'Clean tree' : 'Uncommitted files'}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Size</dt>
          <dd className="mt-0.5 font-extrabold text-ink tabular-nums">{formatBytes(workspace.sizeBytes)}</dd>
          {preview ? (
            <dd className="mt-0.5">
              <a
                href={preview}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[10.5px] font-bold text-success hover:underline"
              >
                Preview live
                <ExternalLink className="size-3" />
              </a>
            </dd>
          ) : previewsEnabled ? (
            <dd className="mt-0.5 text-[10.5px] text-ink-subtle">No preview</dd>
          ) : (
            <dd className="mt-0.5 text-[10.5px] text-ink-subtle">On disk</dd>
          )}
        </div>
      </dl>
    </li>
  );
};
