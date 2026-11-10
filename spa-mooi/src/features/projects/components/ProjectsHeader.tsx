import { FolderInput, FolderPlus, RefreshCw } from 'lucide-react';
import { Eyebrow } from '@/shared/components/Eyebrow';
import { SearchInput } from '@/shared/components/SearchInput';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import { iconAction } from '@/shared/styles/iconAction';
import { cn } from '@/shared/utils/cn';

interface ProjectsHeaderProps {
  onAdd: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  busy: boolean;
  canAdd: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  showSearch: boolean;
}

/** Labelled actions from `sm`, icons on phones: the two ways in stay one tap away at every width. */
export const ProjectsHeader = ({
  onAdd,
  onCreate,
  onRefresh,
  busy,
  canAdd,
  query,
  onQueryChange,
  showSearch,
}: ProjectsHeaderProps) => (
  <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
    <div className="min-w-0">
      <Eyebrow>Projects</Eyebrow>
      <h1 className="mt-2 text-[30px] leading-[1.1] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">
        Your workspace
      </h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        References to repositories you own. Mooi stores no code — only what it needs to recognise
        them.
      </p>
    </div>

    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {showSearch ? (
        <SearchInput
          value={query}
          onChange={onQueryChange}
          placeholder="Search projects"
          className="sm:w-60"
        />
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Refresh projects"
          title="Refresh projects"
          className={iconAction}
        >
          <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          aria-label="Add repository"
          title="Add repository"
          className={buttonStyles('secondary', 'md', 'max-sm:size-10 max-sm:px-0 max-sm:flex-none flex-1 sm:flex-none')}
        >
          <FolderInput className="size-4" />
          <span className="max-sm:hidden">Add repository</span>
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={!canAdd}
          aria-label="Create project"
          title="Create project"
          className={buttonStyles('brand', 'md', 'flex-1 sm:flex-none')}
        >
          <FolderPlus className="size-4" />
          New project
        </button>
      </div>
    </div>
  </div>
);
