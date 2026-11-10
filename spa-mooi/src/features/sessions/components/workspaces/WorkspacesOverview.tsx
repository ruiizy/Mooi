import { FolderGit2, RefreshCw } from 'lucide-react';
import { WorkspaceCard } from '@/features/sessions/components/workspaces/WorkspaceCard';
import { WorkspaceStats } from '@/features/sessions/components/workspaces/WorkspaceStats';
import type { WorkspaceOverview } from '@/features/sessions/types/WorkspaceOverview';
import { Card } from '@/shared/components/Card';
import { CopyButton } from '@/shared/components/CopyButton';
import { EmptyState } from '@/shared/components/EmptyState';
import { Eyebrow } from '@/shared/components/Eyebrow';
import { Tooltip } from '@/shared/components/Tooltip';
import { cn } from '@/shared/utils/cn';
import { shortenPath } from '@/shared/utils/shortenPath';

interface WorkspacesOverviewProps {
  projectId: string;
  /** False for projects that are not web applications, which have no preview concept at all. */
  previewsEnabled: boolean;
  overview: WorkspaceOverview | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}

/** What sits under a project on the sessions pod: one isolated clone per live session. */
export const WorkspacesOverview = ({ projectId, previewsEnabled, overview, loading, error, onReload }: WorkspacesOverviewProps) => {
  if (!overview) {
    if (error) {
      return <EmptyState icon={FolderGit2} title="Workspaces unavailable" description={error} />;
    }

    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index} className="h-[86px] animate-pulse-soft" />
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <Eyebrow>Clones on disk</Eyebrow>
          <p className="mt-1 flex min-w-0 items-center gap-1 font-mono text-[11px] text-ink-subtle">
            <Tooltip content={overview.root} focusable>
              <span className="truncate">{shortenPath(overview.root)}</span>
            </Tooltip>
            <CopyButton value={overview.root} label="Copy workspace root" className="size-7" />
          </p>
        </div>
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-control border border-line px-3 py-1.5 text-xs font-bold text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 sm:self-auto"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error ? <p className="text-[12px] font-bold text-danger">{error}</p> : null}

      <WorkspaceStats overview={overview} previewsEnabled={previewsEnabled} />

      {overview.workspaces.length > 0 ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {overview.workspaces.map((workspace) => (
            <WorkspaceCard
              key={workspace.sessionId}
              projectId={projectId}
              workspace={workspace}
              previewsEnabled={previewsEnabled}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={FolderGit2}
          title="No clones yet"
          description="Every session gets its own isolated clone of this repository. Start one to see it here."
        />
      )}
    </section>
  );
};
