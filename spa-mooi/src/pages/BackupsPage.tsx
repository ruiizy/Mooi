import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DatabaseBackup, FolderGit2, History, LoaderCircle } from 'lucide-react';
import { BackupDetailDialog } from '@/features/backups/components/BackupDetailDialog';
import { BackupHistoryList } from '@/features/backups/components/BackupHistoryList';
import { BackupProjectCard } from '@/features/backups/components/BackupProjectCard';
import { useBackups } from '@/features/backups/hooks/useBackups';
import type { Backup } from '@/features/backups/types/Backup';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { EmptyState } from '@/shared/components/EmptyState';
import { SearchInput } from '@/shared/components/SearchInput';
import { Tabs } from '@/shared/components/Tabs';

const HISTORY_TAB = 'history';

/**
 * Backups across the workspace: pick a project to open its backup view, or review every recorded
 * backup. Nothing runs from here; a project's view owns its whole lifecycle.
 */
export const BackupsPage = () => {
  const { projects, status, error: projectsError, reload: reloadProjects } = useProjects();
  const history = useBackups();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Backup | null>(null);
  const tab = searchParams.get('tab') === HISTORY_TAB ? HISTORY_TAB : 'projects';

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const byProject = useMemo(() => {
    const grouped = new Map<string, Backup[]>();
    history.backups.forEach((backup) => grouped.set(backup.projectId, [...(grouped.get(backup.projectId) ?? []), backup]));
    return grouped;
  }, [history.backups]);
  const visibleProjects = useMemo(() => {
    const term = query.trim().toLowerCase();
    return projects
      .filter((project) => !term || project.fullName.toLowerCase().includes(term))
      .sort((a, b) => (byProject.get(b.id)?.[0]?.startedAt ?? '').localeCompare(byProject.get(a.id)?.[0]?.startedAt ?? ''));
  }, [projects, query, byProject]);
  const protectedProjects = useMemo(() => [...byProject.values()].filter((backups) => backups[0]?.state === 'succeeded').length, [byProject]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Production</p>
          <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">Backups</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">Open a project to prepare, prove and run its backups and restores.</p>
        </div>
        <dl className="flex gap-6">
          <div><dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Projects</dt>
            <dd className="text-xl font-extrabold text-ink tabular-nums">{projects.length}</dd></div>
          <div><dt className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Protected</dt>
            <dd className="text-xl font-extrabold text-ink tabular-nums">{protectedProjects}</dd></div>
        </dl>
      </header>

      <Tabs ariaLabel="Backup views" value={tab} className="-mb-2 border-b border-line"
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
          : projects.length === 0 ? !projectsError && <EmptyState icon={FolderGit2} title="No projects yet" description="Add a project to your workspace to back it up." />
            : visibleProjects.length === 0 ? <p className="py-10 text-center text-sm text-ink-muted">No project matches “{query}”.</p>
              : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleProjects.map((project) => <BackupProjectCard key={project.id} project={project}
                  latest={byProject.get(project.id)?.[0]} count={byProject.get(project.id)?.length ?? 0} />)}
              </div>}
      </section> : <section aria-label="History" className="flex flex-col gap-4">
        {history.error ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{history.error}</span><Button variant="secondary" size="sm" onClick={history.reload}>Retry</Button>
        </div> : null}
        {history.loading && history.backups.length === 0 ? <Card className="h-48 animate-pulse-soft" />
          : history.backups.length === 0 ? !history.error && <EmptyState icon={DatabaseBackup} title="No backups yet"
            description="Every backup appears here with its date, time, release and outcome." />
            : <BackupHistoryList backups={history.backups} projects={projectById} onOpen={setSelected} />}
        {history.hasMore ? <div className="text-center"><Button variant="secondary" onClick={history.loadMore} disabled={history.loading}>
          {history.loading ? <LoaderCircle className="size-4 animate-spin" /> : null}Load more</Button></div> : null}
      </section>}

      {selected ? <BackupDetailDialog key={selected.id} backup={selected}
        projectName={projectById.get(selected.projectId)?.name ?? 'Removed project'} onClose={() => setSelected(null)} /> : null}
    </div>
  );
};
