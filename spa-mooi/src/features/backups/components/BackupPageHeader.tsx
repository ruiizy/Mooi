import { Link } from 'react-router-dom';
import { ChevronLeft, DatabaseBackup, KeyRound, LoaderCircle, Rocket, SlidersHorizontal, Trash2 } from 'lucide-react';
import { deploymentPath } from '@/app/paths';
import { ROUTES } from '@/app/routes';
import { BACKUP_STAGE_VIEWS } from '@/features/backups/lib/backupStageView';
import type { BackupStage } from '@/features/backups/types/BackupStage';
import type { Project } from '@/features/projects/types/Project';
import { ActionsMenu } from '@/shared/components/ActionsMenu';
import { MenuAction } from '@/shared/components/MenuAction';
import { StatusDot } from '@/shared/components/StatusDot';
import { Tabs } from '@/shared/components/Tabs';
import { iconAction } from '@/shared/styles/iconAction';
import type { TabItem } from '@/shared/types/TabItem';

interface BackupPageHeaderProps {
  project: Project;
  stage: BackupStage;
  /** An active, proven configuration exists. */
  active: boolean;
  configured: boolean;
  deployedRelease: string | null;
  tabs: TabItem[];
  tab: string;
  onTabChange: (tab: string) => void;
  onBackup: () => void;
  onReconfigure: () => void;
  onEnvironment: () => void;
  onDelete: () => void;
}

/**
 * Name, lifecycle and the compact action group of the project backup view: distinct icons with
 * labels and titles, the destructive action folded into the menu.
 */
export const BackupPageHeader = ({ project, stage, active, configured, deployedRelease, tabs, tab, onTabChange, onBackup,
  onReconfigure, onEnvironment, onDelete }: BackupPageHeaderProps) => {
  const view = BACKUP_STAGE_VIEWS[stage];
  const running = stage === 'running';

  return (
    <div className="shrink-0 border-b border-line bg-surface">
      <div className="flex items-center gap-1.5 py-2 pr-2 pl-1.5 sm:gap-3 sm:px-5 sm:py-2.5">
        <Link to={ROUTES.backups} aria-label="Back to backups" title="Back to backups"
          className="flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <ChevronLeft className="size-4.5" />
        </Link>

        <div className="min-w-0 flex-1">
          <p className="hidden truncate text-[11px] font-bold text-ink-subtle sm:block">Backups</p>
          <h1 className="flex min-w-0 items-center gap-2 text-[15px] leading-tight font-extrabold tracking-[-0.01em] text-ink sm:text-[16px]">
            <span className="truncate">{project.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-ink-muted" title={view.label}>
              <StatusDot tone={view.tone} pulse={running} /><span className="hidden sm:inline">{view.label}</span>
            </span>
            {deployedRelease ? <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-bold text-ink-muted md:inline-flex" title="Release running in production">
              <Rocket className="size-3.5" /><span className="font-mono">{deployedRelease}</span>
            </span> : null}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {active ? <button type="button" onClick={onBackup} disabled={running || !deployedRelease} aria-label="Create a backup" title="Create a backup" className={iconAction}>
            {running ? <LoaderCircle className="size-4 animate-spin" /> : <DatabaseBackup className="size-4" />}
          </button> : null}
          {configured ? <button type="button" onClick={onReconfigure} disabled={running} aria-label="Change backup settings" title="Change backup settings" className={iconAction}>
            <SlidersHorizontal className="size-4" />
          </button> : null}
          <button type="button" onClick={onEnvironment} aria-label="Environment variables" title="Environment variables" className={iconAction}>
            <KeyRound className="size-4" />
          </button>
          <ActionsMenu label="More backup actions">
            {(dismiss) => <>
              <Link to={deploymentPath(project.id)} onClick={dismiss} role="menuitem"
                className="flex h-11 w-full items-center gap-2.5 rounded-control px-3 text-left text-sm font-bold text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand">
                <Rocket className="size-4 shrink-0" /><span className="truncate">Production deployment</span></Link>
              <div className="my-1 h-px bg-line" />
              <MenuAction icon={Trash2} label="Delete configuration" tone="danger" disabled={!configured || running}
                onClick={() => { dismiss(); onDelete(); }} />
            </>}
          </ActionsMenu>
        </div>
      </div>
      <div className="px-4 sm:px-6">
        <Tabs items={tabs} value={tab} onChange={onTabChange} ariaLabel="Backup views" />
      </div>
    </div>
  );
};
