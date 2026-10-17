import type { SessionStreamState } from '@/features/sessions/lib/openSessionStream';
import type { ChangesSummary } from '@/features/sessions/types/ChangesSummary';
import type { Session } from '@/features/sessions/types/Session';
import type { SessionEvent } from '@/features/sessions/types/SessionEvent';
import type { SessionTranscriptState } from '@/features/sessions/types/SessionTranscriptState';

export interface SessionsState {
  sessions: Session[];
  byId: Record<string, SessionTranscriptState>;
  setDeployment: (sessionId: string, snapshot: import('@/features/sessions/types/DeploymentSnapshot').DeploymentSnapshot) => void;
  markPreviewOpened: (sessionId: string, operationId: string) => void;
  setPane: (sessionId: string, pane: import('@/features/sessions/types/WorkspacePane').WorkspacePane) => void;
  setDeploymentLogOpen: (sessionId: string, open: boolean) => void;
  setSessions: (sessions: Session[]) => void;
  /** Replaces the sessions in scope (one project, or every one) with a fresh server list, dropping the ones gone. */
  /** `knownIds`: sessions in the store when the list was requested; only those may be dropped. */
  syncSessions: (sessions: Session[], projectId?: string, knownIds?: ReadonlySet<string>) => void;
  upsertSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  ensureTranscript: (sessionId: string) => void;
  applyEvent: (sessionId: string, event: SessionEvent) => void;
  setStreamState: (sessionId: string, streamState: SessionStreamState) => void;
  setChanges: (sessionId: string, changes: ChangesSummary, requestSeq?: number) => void;
  setChangesLoading: (sessionId: string) => void;
  setChangesError: (sessionId: string, error: string, requestSeq?: number) => void;
  resetTranscript: (sessionId: string) => void;
  clear: () => void;
}
