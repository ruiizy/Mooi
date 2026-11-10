import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { SearchInput } from '@/shared/components/SearchInput';
import { cn } from '@/shared/utils/cn';

interface SessionsOverviewHeaderProps {
  query: string;
  onQueryChange: (value: string) => void;
  showSearch: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onNewSession: () => void;
}

export const SessionsOverviewHeader = ({ query, onQueryChange, showSearch, refreshing, onRefresh, onNewSession }: SessionsOverviewHeaderProps) => (
  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
    <div>
      <p className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Development</p>
      <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">Sessions</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        Every live session across your projects, kept up to date while agents work and apps deploy.
      </p>
    </div>

    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {showSearch ? (
        <SearchInput value={query} onChange={onQueryChange} placeholder="Search branch, project or agent" className="sm:w-72" />
      ) : null}
      <div className="flex gap-2 *:flex-1 sm:*:flex-none">
        <Button variant="secondary" size="md" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
        <Button variant="brand" size="md" onClick={onNewSession}>
          <Plus className="size-4" />
          New session
        </Button>
      </div>
    </div>
  </div>
);
