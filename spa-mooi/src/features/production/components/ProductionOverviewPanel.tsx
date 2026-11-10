import type { Project } from '@/features/projects/types/Project';
import { PlatformEnvironmentCard } from '@/features/platform/components/PlatformEnvironmentCard';
import { ProductionHero } from '@/features/production/components/ProductionHero';
import { ProductionHistoryCard } from '@/features/production/components/ProductionHistoryCard';
import { ProductionStats } from '@/features/production/components/ProductionStats';
import type { ProductionDeployment } from '@/features/production/types/ProductionDeployment';
import type { ProductionHealth } from '@/features/production/types/ProductionHealth';
import type { ProductionHealthState } from '@/features/production/types/ProductionHealthState';
import type { ProductionOverview } from '@/features/production/types/ProductionOverview';
import type { ProductionStage } from '@/features/production/types/ProductionStage';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';

interface ProductionOverviewPanelProps {
  project: Project;
  overview: ProductionOverview | null;
  error: string | null;
  onRetry: () => void;
  stage: ProductionStage;
  hasChat: boolean;
  missingVariables: number;
  releaseTag: string | null;
  latest: ProductionDeployment | undefined;
  health: { state: ProductionHealthState; health: ProductionHealth | null; error: string | null };
  history: { deployments: ProductionDeployment[]; loading: boolean; error: string | null };
  deploying: boolean;
  onSetup: () => void;
  onDeploy: () => void;
  onOpenChat: () => void;
  onOpenConsole: () => void;
  onFix: () => void;
  onEnvironment: () => void;
  onOpenDeployment: (deployment: ProductionDeployment) => void;
  onRedeploy: (deployment: ProductionDeployment) => void;
}

/** The landing tab: the lifecycle card, then numbers, environment and history once there is something to show. */
export const ProductionOverviewPanel = ({ project, overview, error, onRetry, stage, hasChat, missingVariables, releaseTag, latest,
  health, history, deploying, onSetup, onDeploy, onOpenChat, onOpenConsole, onFix, onEnvironment, onOpenDeployment, onRedeploy }: ProductionOverviewPanelProps) => {
  const started = Boolean(overview?.configured || history.deployments.length > 0 || overview?.environment.length);

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
          <ProductionHero project={project} stage={stage} hasChat={hasChat} missingVariables={missingVariables} releaseTag={releaseTag}
            onSetup={onSetup} onDeploy={onDeploy} onOpenChat={onOpenChat} onOpenConsole={onOpenConsole} onFix={onFix} onEnvironment={onEnvironment} />

          {started ? <>
            <ProductionStats overview={overview} latest={latest} healthState={health.state} health={health.health} healthError={health.error} />
            {health.health?.state === 'unhealthy' && health.health.output ? <details className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3">
              <summary className="cursor-pointer text-sm font-bold text-danger">status.sh reported a problem</summary>
              <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap break-all text-danger">{health.health.output}</pre>
            </details> : null}
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
              <PlatformEnvironmentCard variables={overview.environment} onEdit={onEnvironment}
                emptyDescription="No variables yet. The agent asks for them while it prepares the scripts." />
              <ProductionHistoryCard deployments={history.deployments} loading={history.loading} error={history.error}
                canRedeploy={overview.configured && missingVariables === 0 && stage !== 'deploying' && !deploying}
                onOpen={onOpenDeployment} onRedeploy={onRedeploy} />
            </div>
          </> : null}
        </>}
      </div>
    </div>
  );
};
