import { useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { MessagesSquare, RefreshCw, Search } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { useLiveStatus } from '@/features/live/hooks/useLiveStatus';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { SessionGroupSection } from '@/features/sessions/components/overview/SessionGroupSection';
import { SessionsOverviewHeader } from '@/features/sessions/components/overview/SessionsOverviewHeader';
import { SessionsOverviewStats } from '@/features/sessions/components/overview/SessionsOverviewStats';
import { StartSessionDialog } from '@/features/sessions/components/overview/StartSessionDialog';
import { groupSessionsByProject } from '@/features/sessions/lib/groupSessionsByProject';
import { matchesSessionQuery } from '@/features/sessions/lib/matchesSessionQuery';
import { SESSION_FILTERS, sessionFilter } from '@/features/sessions/lib/sessionFilters';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { EmptyState } from '@/shared/components/EmptyState';
import { Tabs } from '@/shared/components/Tabs';
import type { BackLink } from '@/shared/types/BackLink';
import { useSessionsStore } from '@/stores/sessionsStore';

const FILTER_PARAM = 'filter';

const Skeleton = () => (
  <div className="flex flex-col gap-6">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[0, 1, 2, 3].map((index) => <Card key={index} className="h-[86px] animate-pulse-soft" />)}
    </div>
    <Card className="h-56 animate-pulse-soft" />
  </div>
);

/**
 * Every live session of the player in one place, grouped by project, so checking on agents does
 * not mean opening each project. The list stays live through the player's channel; the active filter
 * lives in `?filter=` so a reload lands back on the same view.
 */
export const SessionsPage = () => {
  const { projects } = useProjects();
  const allSessions = useSessionsStore((state) => state.sessions);
  const sessions = useMemo(() => allSessions.filter((session) => session.kind === 'session'), [allSessions]);
  const { loading, error, reconnect: reload } = useLiveStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const { search } = useLocation();
  const backLink: BackLink = useMemo(() => ({ to: `${ROUTES.sessions}${search}`, label: 'Sessions' }), [search]);
  const filter = sessionFilter(searchParams.get(FILTER_PARAM));

  const searched = useMemo(() => sessions.filter((session) => matchesSessionQuery(session, query)), [sessions, query]);
  const groups = useMemo(
    () => groupSessionsByProject(searched.filter(filter.matches), projects),
    [searched, filter, projects],
  );

  const handleFilterChange = (next: string) =>
    setSearchParams(next === SESSION_FILTERS[0].id ? {} : { [FILTER_PARAM]: next }, { replace: true });

  const showAll = () => {
    setQuery('');
    handleFilterChange(SESSION_FILTERS[0].id);
  };

  const firstLoad = loading && sessions.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
      <SessionsOverviewHeader query={query} onQueryChange={setQuery} showSearch={sessions.length > 0}
        refreshing={loading} onRefresh={reload} onNewSession={() => setNewSessionOpen(true)} />

      {error ? (
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

      {firstLoad ? <Skeleton /> : null}

      {!firstLoad && sessions.length === 0 && !error ? (
        <EmptyState icon={MessagesSquare} title="No live sessions"
          description="Start a session to have an agent work on one of your projects. It shows up here while it runs." />
      ) : null}

      {sessions.length > 0 ? (
        <>
          <SessionsOverviewStats sessions={sessions} />

          <Tabs
            ariaLabel="Session filters"
            value={filter.id}
            onChange={handleFilterChange}
            className="-mb-2 border-b border-line"
            items={SESSION_FILTERS.map(({ id, label, icon, matches }) => ({
              id, label, icon, count: searched.filter(matches).length,
            }))}
          />

          {groups.length > 0 ? (
            <div className="flex flex-col gap-8">
              {groups.map((group) => <SessionGroupSection key={group.projectId} group={group} backLink={backLink} />)}
            </div>
          ) : (
            <EmptyState icon={Search} title="No sessions match" description="Try another search or filter.">
              <Button variant="ghost" onClick={showAll}>Show all sessions</Button>
            </EmptyState>
          )}
        </>
      ) : null}

      <StartSessionDialog open={newSessionOpen} initialProjectId={sessions[0]?.projectId ?? projects[0]?.id ?? null}
        backLink={backLink} onClose={() => setNewSessionOpen(false)} />
    </div>
  );
};
