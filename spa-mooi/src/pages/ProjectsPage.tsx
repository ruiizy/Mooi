import { useMemo, useState } from 'react';
import { FolderGit2, Plus, RefreshCw, Search } from 'lucide-react';
import { GithubGateCard } from '@/features/github/components/GithubGateCard';
import { useGithubLinked } from '@/features/github/hooks/useGithubLinked';
import { AddProjectDialog } from '@/features/projects/components/AddProjectDialog';
import { CreateProjectDialog } from '@/features/projects/components/CreateProjectDialog';
import { ProjectGrid } from '@/features/projects/components/ProjectGrid';
import { ProjectsHeader } from '@/features/projects/components/ProjectsHeader';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { Button } from '@/shared/components/Button';
import { EmptyState } from '@/shared/components/EmptyState';
import { Eyebrow } from '@/shared/components/Eyebrow';

const Skeleton = () => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {[0, 1, 2].map((card) => (
      <div
        key={card}
        className="h-[196px] animate-pulse-soft rounded-card border border-line bg-surface"
      />
    ))}
  </div>
);

/**
 * The homepage of a signed-in player: the workspace is its projects, so there is nothing to put in
 * front of them.
 *
 * It starts empty until the player creates or imports a GitHub repository.
 */
export const ProjectsPage = () => {
  const { linked, resolved } = useGithubLinked();
  const { projects, status, error, reload } = useProjects();
  const [query, setQuery] = useState('');
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (needle.length === 0) {
      return projects;
    }

    return projects.filter(
      (project) =>
        project.fullName.toLowerCase().includes(needle) ||
        (project.description ?? '').toLowerCase().includes(needle),
    );
  }, [projects, query]);

  if (resolved && !linked) {
    return (
      <div className="mx-auto w-full max-w-6xl px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
        <GithubGateCard
          title="Connect GitHub to add projects"
          description="Mooi builds on your repositories. Link your GitHub account and import the ones you want to work on."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
      <ProjectsHeader
        onAdd={() => setDialogOpen(true)}
        onCreate={() => setCreateOpen(true)}
        onRefresh={reload}
        busy={status === 'loading'}
        canAdd={linked}
        query={query}
        onQueryChange={setQuery}
        showSearch={projects.length > 0}
      />

      {visibleProjects.length > 0 ? (
        <div className="mt-8 flex items-center justify-between gap-3 border-b border-line pb-2.5">
          <Eyebrow>All projects</Eyebrow>
          <span className="font-mono text-[11px] text-ink-subtle tabular-nums">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </span>
        </div>
      ) : null}

      <div className="mt-6">
        {status === 'loading' && projects.length === 0 ? <Skeleton /> : null}

        {status === 'error' ? (
          <div className="flex flex-col gap-3 rounded-card border border-danger/30 bg-danger-soft px-4 py-3.5 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm text-danger">{error}</p>
            <span className="shrink-0">
              <Button variant="secondary" size="sm" onClick={reload}>
                <RefreshCw className="size-4" />
                Try again
              </Button>
            </span>
          </div>
        ) : null}

        {status === 'ready' && projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="Add a GitHub repository to start working on it here."
          >
            <Button variant="brand" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Create project
            </Button>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              Add repository
            </Button>
          </EmptyState>
        ) : null}

        {projects.length > 0 && visibleProjects.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No projects match"
            description="Try another search term."
          >
            <Button variant="ghost" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </EmptyState>
        ) : null}

        {visibleProjects.length > 0 ? (
          <ProjectGrid
            projects={visibleProjects}
            onAdd={() => setDialogOpen(true)}
            canAdd={linked}
          />
        ) : null}
      </div>

      <AddProjectDialog open={isDialogOpen} onClose={() => setDialogOpen(false)} />
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
};
