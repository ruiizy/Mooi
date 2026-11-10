import { Link } from 'react-router-dom';
import { Activity, ChevronLeft, ExternalLink, KeyRound, LoaderCircle, Rocket, SlidersHorizontal, Trash2 } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import type { Project } from '@/features/projects/types/Project';
import { PRODUCTION_STAGE_VIEWS } from '@/features/production/lib/productionStageView';
import type { ProductionHealthState } from '@/features/production/types/ProductionHealthState';
import type { ProductionStage } from '@/features/production/types/ProductionStage';
import { ActionsMenu } from '@/shared/components/ActionsMenu';
import { MenuAction } from '@/shared/components/MenuAction';
import { StatusDot } from '@/shared/components/StatusDot';
import { Tabs } from '@/shared/components/Tabs';
import { iconAction } from '@/shared/styles/iconAction';
import type { TabItem } from '@/shared/types/TabItem';

interface ProductionPageHeaderProps {
  project: Project;
  stage: ProductionStage;
  configured: boolean;
  healthState: ProductionHealthState;
  tabs: TabItem[];
  tab: string;
  onTabChange: (tab: string) => void;
  onDeploy: () => void;
  onReconfigure: () => void;
  onEnvironment: () => void;
  onCheckStatus: () => void;
  onDelete: () => void;
}

const HEALTH_TONES = { unknown: 'neutral', checking: 'info', healthy: 'success', unhealthy: 'danger' } as const;
const HEALTH_LABELS = { unknown: 'Service status unknown', checking: 'Checking the service…', healthy: 'Service online', unhealthy: 'Service needs attention' };

/**
 * Name, lifecycle and the compact action group of the project detail view: distinct icons with
 * labels and titles, the destructive action folded into the menu.
 */
export const ProductionPageHeader = ({ project, stage, configured, healthState, tabs, tab, onTabChange, onDeploy,
  onReconfigure, onEnvironment, onCheckStatus, onDelete }: ProductionPageHeaderProps) => {
  const view = PRODUCTION_STAGE_VIEWS[stage];
  const deploying = stage === 'deploying';

  return (
    <div className="shrink-0 border-b border-line bg-surface">
      <div className="flex items-center gap-1.5 py-2 pr-2 pl-1.5 sm:gap-3 sm:px-5 sm:py-2.5">
        <Link to={ROUTES.deployments} aria-label="Back to deployments" title="Back to deployments"
          className="flex size-10 shrink-0 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          <ChevronLeft className="size-4.5" />
        </Link>

        <div className="min-w-0 flex-1">
          <p className="hidden truncate text-[11px] font-bold text-ink-subtle sm:block">Deployments</p>
          <h1 className="flex min-w-0 items-center gap-2 text-[15px] leading-tight font-extrabold tracking-[-0.01em] text-ink sm:text-[16px]">
            <span className="truncate">{project.name}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-ink-muted" title={view.label}>
              <StatusDot tone={view.tone} pulse={deploying} /><span className="hidden sm:inline">{view.label}</span>
            </span>
            {configured ? <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-bold text-ink-muted md:inline-flex" title={HEALTH_LABELS[healthState]}>
              <StatusDot tone={HEALTH_TONES[healthState]} pulse={healthState === 'checking'} />{HEALTH_LABELS[healthState]}
            </span> : null}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {configured ? <button type="button" onClick={onDeploy} disabled={deploying} aria-label="Deploy a release" title="Deploy a release" className={iconAction}>
            {deploying ? <LoaderCircle className="size-4 animate-spin" /> : <Rocket className="size-4" />}
          </button> : null}
          {configured ? <button type="button" onClick={onReconfigure} disabled={deploying} aria-label="Change deployment settings" title="Change deployment settings" className={iconAction}>
            <SlidersHorizontal className="size-4" />
          </button> : null}
          <button type="button" onClick={onEnvironment} aria-label="Environment variables" title="Environment variables" className={iconAction}>
            <KeyRound className="size-4" />
          </button>
          {configured ? <button type="button" onClick={onCheckStatus} disabled={deploying || healthState === 'checking'} aria-label="Check service status" title="Check service status" className={`${iconAction} hidden sm:inline-flex`}>
            <Activity className="size-4" />
          </button> : null}
          <ActionsMenu label="More deployment actions">
            {(dismiss) => <>
              {configured ? <div className="sm:hidden"><MenuAction icon={Activity} label="Check service status" disabled={deploying}
                onClick={() => { dismiss(); onCheckStatus(); }} /></div> : null}
              {project.htmlUrl ? <MenuAction icon={ExternalLink} label="GitHub releases"
                onClick={() => { dismiss(); window.open(`${project.htmlUrl}/releases`, '_blank', 'noopener,noreferrer'); }} /> : null}
              <div className="my-1 h-px bg-line" />
              <MenuAction icon={Trash2} label="Delete configuration" tone="danger" disabled={!configured || deploying}
                onClick={() => { dismiss(); onDelete(); }} />
            </>}
          </ActionsMenu>
        </div>
      </div>
      <div className="px-4 sm:px-6">
        <Tabs items={tabs} value={tab} onChange={onTabChange} ariaLabel="Deployment views" />
      </div>
    </div>
  );
};
