import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sessionPath } from '@/app/paths';
import { useAgentConnections } from '@/features/agents/hooks/useAgentConnections';
import { useGithubLinked } from '@/features/github/hooks/useGithubLinked';
import { AddProjectDialog } from '@/features/projects/components/AddProjectDialog';
import { CreateProjectDialog } from '@/features/projects/components/CreateProjectDialog';
import { ProjectSelect } from '@/features/projects/components/ProjectSelect';
import { useProjects } from '@/features/projects/hooks/useProjects';
import { NewSessionDialog } from '@/features/sessions/components/NewSessionDialog';
import { useProjectSessions } from '@/features/sessions/hooks/useProjectSessions';
import type { CreateSessionRequest } from '@/features/sessions/types/CreateSessionRequest';
import type { BackLink } from '@/shared/types/BackLink';
import { backLinkState } from '@/shared/utils/backLinkState';

interface StartSessionDialogProps {
  open: boolean;
  /** Project picked when the dialog opens, e.g. the one worked on last. */
  initialProjectId: string | null;
  /** Where the new session's back button returns. */
  backLink: BackLink;
  onClose: () => void;
}

/**
 * New session from the Sessions overview: the same dialog a project offers, plus a project picker
 * that can import or create the project in place, so starting work never detours through Projects.
 */
export const StartSessionDialog = ({ open, initialProjectId, backLink, onClose }: StartSessionDialogProps) => {
  const navigate = useNavigate();
  const { projects } = useProjects();
  const { linked } = useGithubLinked();
  const { connections, reload: reloadConnections } = useAgentConnections();
  const { busy, actionError, create, clearActionError } = useProjectSessions(undefined);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [adding, setAdding] = useState<'import' | 'create' | null>(null);
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const wasOpen = useRef(false);

  /** Only opening picks the initial project: live session updates must not override the user's choice. */
  useEffect(() => {
    if (open && !wasOpen.current) setProjectId(initialProjectId);
    wasOpen.current = open;
  }, [open, initialProjectId]);

  const close = () => {
    clearActionError();
    onClose();
  };

  const handleCreate = (request: CreateSessionRequest) =>
    create(request).then((session) => {
      if (!session) return false;
      navigate(sessionPath(session.projectId, session.id), { state: backLinkState(backLink) });
      return true;
    });

  return (
    <>
      <NewSessionDialog
        open={open}
        project={project}
        projectPicker={
          <ProjectSelect projects={projects} value={projectId} onChange={setProjectId}
            onImport={linked ? () => setAdding('import') : undefined}
            onCreate={linked ? () => setAdding('create') : undefined} />
        }
        connections={connections}
        busy={busy}
        actionError={actionError}
        onRefreshConnections={reloadConnections}
        onClose={close}
        onCreate={handleCreate}
      />
      <AddProjectDialog open={adding === 'import'} onClose={() => setAdding(null)} onAdded={(added) => setProjectId(added.id)} />
      <CreateProjectDialog open={adding === 'create'} onClose={() => setAdding(null)} onAdded={(added) => setProjectId(added.id)} />
    </>
  );
};
