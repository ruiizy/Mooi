import { BackupHero } from '@/features/backups/components/BackupHero';
import { BackupListCard } from '@/features/backups/components/BackupListCard';
import { BackupStats } from '@/features/backups/components/BackupStats';
import type { Backup } from '@/features/backups/types/Backup';
import type { BackupOverview } from '@/features/backups/types/BackupOverview';
import type { BackupStage } from '@/features/backups/types/BackupStage';
import { PlatformEnvironmentCard } from '@/features/platform/components/PlatformEnvironmentCard';
import type { Project } from '@/features/projects/types/Project';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';

interface BackupOverviewPanelProps {
  project: Project;
  overview: BackupOverview | null;
  error: string | null;
  onRetry: () => void;
  stage: BackupStage;
  hasChat: boolean;
  missingVariables: number;
  list: { backups: Backup[]; loading: boolean; error: string | null; hasMore: boolean; loadMore: () => void };
  busy: boolean;
  onSetup: () => void;
  onBackup: () => void;
  onOpenChat: () => void;
  onOpenConsole: () => void;
  onFix: () => void;
  onEnvironment: () => void;
  onOpenBackup: (backup: Backup) => void;
  onVerify: (backup: Backup) => void;
  onRestore: (backup: Backup) => void;
  onDelete: (backup: Backup) => void;
}

/** The landing tab: the lifecycle card, then numbers, backups and environment once there is something to show. */
export const BackupOverviewPanel = ({ project, overview, error, onRetry, stage, hasChat, missingVariables, list, busy, onSetup,
  onBackup, onOpenChat, onOpenConsole, onFix, onEnvironment, onOpenBackup, onVerify, onRestore, onDelete }: BackupOverviewPanelProps) => {
  const started = Boolean(overview?.configured || list.backups.length > 0 || overview?.environment.length);
  const locked = !overview?.active || stage === 'running' || busy;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span className="min-w-0 flex-1">{error}</span>
          {!overview ? <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
        </div> : null}

        {!overview ? !error ? <>
          <Card className="h-64 animate-pulse-soft" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <Card key={item} className="h-20 animate-pulse-soft" />)}</div>
        </> : null : <>
          <BackupHero project={project} stage={stage} hasChat={hasChat} missingVariables={missingVariables}
            deployedRelease={overview.deployedRelease} busy={busy} onSetup={onSetup} onBackup={onBackup} onOpenChat={onOpenChat}
            onOpenConsole={onOpenConsole} onFix={onFix} onEnvironment={onEnvironment} />

          {started ? <>
            <BackupStats overview={overview} backups={list.backups} hasMore={list.hasMore} />
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <BackupListCard backups={list.backups} loading={list.loading} error={list.error} hasMore={list.hasMore}
                deployedRelease={overview.deployedRelease} locked={locked} onLoadMore={list.loadMore}
                onOpen={onOpenBackup} onVerify={onVerify} onRestore={onRestore} onDelete={onDelete} />
              <PlatformEnvironmentCard variables={overview.environment} onEdit={onEnvironment}
                emptyDescription="No variables yet. The agent asks for them while it prepares the scripts; production values are reused." />
            </div>
          </> : null}
        </>}
      </div>
    </div>
  );
};
