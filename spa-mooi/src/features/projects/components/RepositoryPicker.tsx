import { useMemo } from 'react';
import { FolderGit2, RefreshCw, Search } from 'lucide-react';
import type { GithubRepository } from '@/features/github/types/GithubRepository';
import { RepositoryRow } from '@/features/projects/components/RepositoryRow';
import { Button } from '@/shared/components/Button';
import { EmptyState } from '@/shared/components/EmptyState';
import { Eyebrow } from '@/shared/components/Eyebrow';
import { SearchInput } from '@/shared/components/SearchInput';

interface RepositoryPickerProps {
  repositories: GithubRepository[];
  installations: number | null;
  loading: boolean;
  failure: string | null;
  addedRepoIds: Set<number>;
  query: string;
  onQueryChange: (query: string) => void;
  onReload: () => void;
  onManageAccess: () => void;
  onSelect: (repository: GithubRepository) => void;
}

const Skeleton = () => (
  <ul className="flex animate-pulse-soft flex-col gap-3">
    {[0, 1, 2, 3].map((row) => (
      <li key={row} className="flex items-center gap-3">
        <span className="size-9 shrink-0 rounded-xl bg-surface-2" />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="h-3.5 w-44 rounded-full bg-surface-2" />
          <span className="h-3 w-64 max-w-full rounded-full bg-surface-2" />
        </span>
      </li>
    ))}
  </ul>
);

/**
 * The first step of adding a repository. Repositories already in the workspace stay visible and
 * marked instead of being filtered out, so a player who cannot find one is told why.
 */
export const RepositoryPicker = ({
  repositories,
  installations,
  loading,
  failure,
  addedRepoIds,
  query,
  onQueryChange,
  onReload,
  onManageAccess,
  onSelect,
}: RepositoryPickerProps) => {
  const visibleRepositories = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (needle.length === 0) {
      return repositories;
    }

    return repositories.filter(
      (repository) =>
        repository.fullName.toLowerCase().includes(needle) ||
        (repository.description ?? '').toLowerCase().includes(needle),
    );
  }, [query, repositories]);

  // A token that reaches private repositories on its own (classic OAuth or personal access token)
  // needs no installation: only a public-only list means Mooi was never let in.
  const publicOnly = installations === 0 && !repositories.some((repository) => repository.isPrivate);

  return (
    <>
      {/* Zero installations is the difference between "you own nothing else" and "Mooi was never
          let in" — without saying so, a list missing every private repository looks like a bug. */}
      {!loading && !failure && publicOnly ? (
        <div className="mb-4 flex flex-col gap-3 rounded-control border border-warning/25 bg-warning-soft px-4 py-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink">
            <span className="font-medium">
              {repositories.length === 0
                ? 'Mooi cannot reach your repositories yet.'
                : 'Only public repositories are listed.'}
            </span>
            <span className="text-ink-muted">
              {' '}Install the Mooi GitHub App on the repositories you want to work on, then reload.
            </span>
          </p>
          <span className="shrink-0">
            <Button variant="primary" size="sm" onClick={onManageAccess}>
              Grant access
            </Button>
          </span>
        </div>
      ) : null}

      <div className="flex gap-2">
        <span className="flex-1">
          <SearchInput value={query} onChange={onQueryChange} placeholder="Search repositories" />
        </span>
        <Button variant="secondary" size="md" onClick={onReload}>
          <RefreshCw className="size-4" />
          Reload
        </Button>
      </div>

      {!loading && !failure && repositories.length > 0 ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <Eyebrow>
            {visibleRepositories.length} reachable{' '}
            {visibleRepositories.length === 1 ? 'repository' : 'repositories'}
          </Eyebrow>
          <span className="text-[11px] text-ink-subtle">Checked a moment ago</span>
        </div>
      ) : null}

      <div className="mt-4">
        {loading ? <Skeleton /> : null}

        {!loading && failure ? (
          <div className="flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3.5 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-sm text-danger">{failure}</p>
            <span className="shrink-0">
              <Button variant="secondary" size="sm" onClick={onReload}>
                <RefreshCw className="size-4" />
                Try again
              </Button>
            </span>
          </div>
        ) : null}

        {!loading && !failure && repositories.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No repositories available"
            description="Grant Mooi access to the repositories you want to work on."
          />
        ) : null}

        {!loading && !failure && repositories.length > 0 && visibleRepositories.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No repository matches"
            description="Try another search term."
          />
        ) : null}

        {!loading && !failure && visibleRepositories.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {visibleRepositories.map((repository) => (
              <RepositoryRow
                key={repository.id}
                repository={repository}
                added={addedRepoIds.has(repository.id)}
                onSelect={() => onSelect(repository)}
              />
            ))}
          </ul>
        ) : null}

        {/* Quiet, and always there: searching an incomplete list is the moment a player needs the
            way to widen it, and by then the notice above may no longer apply. */}
        {!loading && !failure && repositories.length > 0 ? (
          <button
            type="button"
            onClick={onManageAccess}
            className="mt-5 w-full border-t border-line pt-4 text-left text-[11px] leading-relaxed text-ink-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Missing a repository?
            <br />
            <span className="font-bold text-brand underline-offset-4 hover:underline">
              Manage GitHub access
            </span>
          </button>
        ) : null}
      </div>
    </>
  );
};
