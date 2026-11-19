import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { Compass, FolderGit2, ListTodo, MessagesSquare, Plus } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { sessionPath } from '@/app/paths';
import { useAgentConnections } from '@/features/agents/hooks/useAgentConnections';
import { ProjectHeader } from '@/features/projects/components/ProjectHeader';
import {
  RemoveProjectDialog,
  type ProjectRemovalAction,
} from '@/features/projects/components/RemoveProjectDialog';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { findProject } from '@/features/projects/lib/findProject';
import { NewSessionDialog } from '@/features/sessions/components/NewSessionDialog';
import { SessionList } from '@/features/sessions/components/SessionList';
import { WorkspacesOverview } from '@/features/sessions/components/workspaces/WorkspacesOverview';
import { useProjectSessions } from '@/features/sessions/hooks/useProjectSessions';
import { useProjectWorkspaces } from '@/features/sessions/hooks/useProjectWorkspaces';
import { TodosPanel } from '@/features/todos/components/TodosPanel';
import { Card } from '@/shared/components/Card';
import { EmptyState } from '@/shared/components/EmptyState';
import { Button } from '@/shared/components/Button';
import { Tabs } from '@/shared/components/Tabs';
import { buttonStyles } from '@/shared/styles/buttonStyles';
import { useLiveStore } from '@/stores/liveStore';

/**
 * What Mooi knows about an imported repository, and nothing it does not.
 *
 * Deploy and preview live inside each session; whether sessions offer them is a project setting,
 * edited from the header.
 *
 * The active tab lives in `?tab=` so a reload lands back on the same view. The to-do list is the
 * repository's own `docs/TODOS.md`, so its tab reads and commits that file rather than any copy.
 */
const WORKSPACES_TAB = 'workspaces';
const TODOS_TAB = 'todos';
const TABS = new Set([WORKSPACES_TAB, TODOS_TAB]);

export const ProjectPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const {
    projects,
    status,
    busy,
    actionError: removalError,
    clearActionError: clearRemovalError,
    unlink,
    deleteRepository,
  } = useProjects();
  const project = findProject(projects, projectId);
  const { sessions, busy: sessionBusy, actionError, create, clearActionError } = useProjectSessions(project?.id);
  const { connections, reload: reloadConnections } = useAgentConnections();
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [removalOpen, setRemovalOpen] = useState(false);
  const [removalAction, setRemovalAction] = useState<ProjectRemovalAction | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = requestedTab && TABS.has(requestedTab) ? requestedTab : 'sessions';
  const todos = useLiveStore((live) => (projectId ? live.todos[projectId] : undefined));
  const sessionsRevision = useMemo(
    () => sessions.map((session) => `${session.id}:${session.status}:${session.deployment.state}:${session.workspacePath ?? ''}`).join('|'),
    [sessions],
  );
  const workspaces = useProjectWorkspaces(tab === WORKSPACES_TAB ? project?.id : undefined, sessionsRevision);

  const handleTabChange = (next: string) =>
    setSearchParams(TABS.has(next) ? { tab: next } : {}, { replace: true });

  if (!project) {
    if (status === 'loading' || status === 'idle') {
      return (
        <div className="mx-auto w-full max-w-6xl px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
          <Card className="h-44 animate-pulse-soft" />
        </div>
      );
    }

    return (
      <div className="mx-auto w-full max-w-6xl px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
        <EmptyState
          icon={Compass}
          title="Project not found"
          description="This project is not part of your workspace."
        >
          <Link to={ROUTES.projects} className={buttonStyles('secondary', 'md')}>
            Back to projects
          </Link>
        </EmptyState>
      </div>
    );
  }

  const handleRemove = (action: ProjectRemovalAction) => {
    setRemovalAction(action);
    const request = action === 'unlink' ? unlink(project.id) : deleteRepository(project.id);
    void request.then((removed) => {
      if (removed) {
        navigate(ROUTES.projects, { replace: true });
      }
    }).finally(() => {
      setRemovalAction(null);
    });
  };

  const handleCreateSession = (request: Parameters<typeof create>[0]) =>
    create(request).then((session) => {
      if (session) {
        navigate(sessionPath(project.id, session.id));
        return true;
      }

      return false;
    });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
      <ProjectHeader
        project={project}
        busy={busy}
        onRemove={() => { clearRemovalError(); setRemovalOpen(true); }}
      />

      <Tabs
        ariaLabel="Project views"
        value={tab}
        onChange={handleTabChange}
        className="-mb-2 border-b border-line"
        items={[
          { id: 'sessions', label: 'Sessions', icon: MessagesSquare, count: sessions.length },
          {
            id: WORKSPACES_TAB,
            label: 'Workspaces',
            icon: FolderGit2,
            count: sessions.filter((session) => session.workspacePath).length,
          },
          {
            id: TODOS_TAB,
            label: 'To-dos',
            icon: ListTodo,
            // Open items, once the file was read: the tab never reaches GitHub before it is opened.
            count: todos?.state === 'ready' ? todos.items.filter((item) => item.status !== 'done').length : undefined,
          },
        ]}
      />

      {tab === TODOS_TAB ? (
        <TodosPanel projectId={project.id} branch={project.defaultBranch ?? 'the default branch'} />
      ) : tab === WORKSPACES_TAB ? (
        <WorkspacesOverview
          projectId={project.id}
          previewsEnabled={project.webApplication}
          overview={workspaces.overview}
          loading={workspaces.loading}
          error={workspaces.error}
          onReload={workspaces.reload}
        />
      ) : sessions.length > 0 ? (
        <SessionList sessions={sessions} onNewSession={() => setNewSessionOpen(true)} />
      ) : (
        <EmptyState
          icon={MessagesSquare}
          title="No sessions yet"
          description="Start one to have an agent work on this repository in its own isolated clone."
        >
          <Button variant="brand" size="lg" onClick={() => setNewSessionOpen(true)} className="px-7">
            <Plus className="size-5" />
            New session
          </Button>
        </EmptyState>
      )}

      <NewSessionDialog
        open={newSessionOpen}
        project={project}
        connections={connections}
        busy={sessionBusy}
        actionError={actionError}
        onRefreshConnections={reloadConnections}
        onClose={() => {
          setNewSessionOpen(false);
          clearActionError();
        }}
        onCreate={handleCreateSession}
      />
      {removalOpen ? (
        <RemoveProjectDialog
          project={project}
          busyAction={removalAction}
          error={removalError}
          onClose={() => { if (!busy) setRemovalOpen(false); }}
          onUnlink={() => handleRemove('unlink')}
          onDeleteRepository={() => handleRemove('delete-repository')}
        />
      ) : null}
    </div>
  );
};
