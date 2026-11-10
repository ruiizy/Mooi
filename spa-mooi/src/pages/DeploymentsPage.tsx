import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FolderGit2, History, LoaderCircle, Rocket } from 'lucide-react';
import { deploymentPath } from '@/app/paths';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { deleteProductionDeployment } from '@/features/production/api/productionApi';
import { ProductionDeploymentDetailDialog } from '@/features/production/components/ProductionDeploymentDetailDialog';
import { ProductionHistoryList } from '@/features/production/components/ProductionHistoryList';
import { ProductionProjectCard } from '@/features/production/components/ProductionProjectCard';
import { useProductionDeployments } from '@/features/production/hooks/useProductionDeployments';
import type { ProductionDeployment } from '@/features/production/types/ProductionDeployment';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { EmptyState } from '@/shared/components/EmptyState';
import { SearchInput } from '@/shared/components/SearchInput';
import { Tabs } from '@/shared/components/Tabs';

const HISTORY_TAB = 'history';

/**
 * Production across the workspace: pick a project to open its deployment view, or review every
 * recorded release. Nothing is started from here; a project's view owns its whole lifecycle.
 */
export const DeploymentsPage = () => {
  const navigate = useNavigate();
  const { projects, status, error: projectsError, reload: reloadProjects } = useProjects();
  const history = useProductionDeployments(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ProductionDeployment | null>(null);
  const tab = searchParams.get('tab') === HISTORY_TAB ? HISTORY_TAB : 'projects';

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const latestByProject = useMemo(() => {
    const latest = new Map<string, ProductionDeployment>();
    history.deployments.forEach((deployment) => { if (!latest.has(deployment.projectId)) latest.set(deployment.projectId, deployment); });
    return latest;
  }, [history.deployments]);
  const visibleProjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    return projects
      .filter((project) => !term || project.fullName.toLowerCase().includes(term))
      .sort((a, b) => (latestByProject.get(b.id)?.startedAt ?? '').localeCompare(latestByProject.get(a.id)?.startedAt ?? ''));
  }, [projects, query, latestByProject]);
  const live = useMemo(() => [...latestByProject.values()].filter((deployment) => deployment.state === 'succeeded').length, [latestByProject]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Production</p>
          <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">Deployments</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">Open a project to prepare, deploy and watch its production release.</p>
        </div>
        <dl className="flex gap-6">
          <div><dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Projects</dt>
            <dd className="text-xl font-extrabold text-ink tabular-nums">{projects.length}</dd></div>
          <div><dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Live</dt>
            <dd className="text-xl font-extrabold text-ink tabular-nums">{live}</dd></div>
        </dl>
      </header>

      <Tabs ariaLabel="Deployment views" value={tab} className="-mb-2 border-b border-line"
        onChange={(next) => setSearchParams(next === HISTORY_TAB ? { tab: HISTORY_TAB } : {}, { replace: true })}
        items={[{ id: 'projects', label: 'Projects', icon: FolderGit2, count: projects.length },
          { id: HISTORY_TAB, label: 'History', icon: History }]} />

      {tab === 'projects' ? <section aria-label="Projects" className="flex flex-col gap-4">
        {projectsError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{projectsError}</span><Button variant="secondary" size="sm" onClick={reloadProjects}>Retry</Button>
        </div> : null}
        {projects.length > 6 ? <SearchInput value={query} onChange={setQuery} placeholder="Search projects" className="sm:max-w-sm" /> : null}
        {(status === 'loading' || status === 'idle') && projects.length === 0
          ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <Card key={item} className="h-44 animate-pulse-soft" />)}</div>
          : projects.length === 0 ? !projectsError && <EmptyState icon={FolderGit2} title="No projects yet" description="Add a project to your workspace to deploy it to production." />
            : visibleProjects.length === 0 ? <p className="py-10 text-center text-sm text-ink-muted">No project matches “{query}”.</p>
              : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleProjects.map((project) => <ProductionProjectCard key={project.id} project={project} latest={latestByProject.get(project.id)} />)}
              </div>}
      </section> : <section aria-label="History" className="flex flex-col gap-4">
        {history.error ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{history.error}</span><Button variant="secondary" size="sm" onClick={history.reload}>Retry</Button>
        </div> : null}
        {history.loading && history.deployments.length === 0 ? <Card className="h-48 animate-pulse-soft" />
          : history.deployments.length === 0 ? !history.error && <EmptyState icon={Rocket} title="No deployments yet"
            description="Every production release appears here with its outcome, files and output." />
            : <ProductionHistoryList deployments={history.deployments} projects={projectById} onOpen={setSelected} />}
        {history.hasMore ? <div className="text-center"><Button variant="secondary" onClick={() => void history.loadMore()} disabled={history.loading}>
          {history.loading ? <LoaderCircle className="size-4 animate-spin" /> : null}Load more</Button></div> : null}
      </section>}

      {selected ? <ProductionDeploymentDetailDialog key={selected.operationId} deployment={selected}
        projectName={projectById.get(selected.projectId)?.name ?? 'Removed project'} onClose={() => setSelected(null)}
        onFix={projectById.has(selected.projectId) ? () => navigate(deploymentPath(selected.projectId)) : undefined}
        onDelete={async () => {
          await deleteProductionDeployment(selected.projectId, selected.operationId);
          history.remove(selected.operationId);
          setSelected(null);
        }} /> : null}
    </div>
  );
};
