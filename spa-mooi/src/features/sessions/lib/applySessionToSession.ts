import type { SessionUsage } from '@/features/sessions/types/SessionUsage';
import { mergeDeployment } from './mergeDeployment';
import type { DeploymentSetup } from '@/features/sessions/types/DeploymentSetup';
import type { QueuedMessage } from '@/features/sessions/types/QueuedMessage';
import type { Session } from '@/features/sessions/types/Session';
import type { SessionEvent } from '@/features/sessions/types/SessionEvent';
import type { SessionStatus } from '@/features/sessions/types/SessionStatus';

/**
 * Patches the subset of `Session` that the same event stream also determines server-side —
 * `status`, `detail`, `pending`, `updatedAt`, `lastSeq` — mirroring `record()` in
 * `mic-sessions/features/sessions.py` so the session list and header badge stay live while a
 * session's stream is open, without a refetch (server and client fold the same events
 * the same way).
 */
export const applySessionToSession = (session: Session, event: SessionEvent): Session => {
  const { type, data, at, seq } = event;
  if (type === 'session.sync') {
    const incoming = data.session as unknown as Session;
    return seq >= session.lastSeq ? { ...incoming, deployment: mergeDeployment(session.deployment, incoming.deployment) } : session;
  }
  if (seq <= session.lastSeq || type === 'history.reset') return session;
  if (event.type === 'deployment.updated') {
    return { ...session, lastSeq: seq, deployment: mergeDeployment(session.deployment, event.data) };
  }
  if (type === 'deployment.log') return { ...session, lastSeq: seq };
  if (type === 'session.queue') return { ...session, lastSeq: seq, queue: (data.messages as QueuedMessage[] | undefined) ?? [] };
  const patch: Partial<Session> = { updatedAt: at, lastSeq: seq };

  if (type === 'session.usage') {
    patch.usage = { ...session.usage, ...Object.fromEntries(Object.entries(data).filter(([key]) => key === 'context' || key === 'quota')) } as SessionUsage;
    if (data.quota && typeof data.quota === 'object') patch.usage.quota = { ...session.usage?.quota, ...data.quota as SessionUsage['quota'] };
  } else if (type === 'session.status') {
    patch.status = (data.status as SessionStatus | undefined) ?? session.status;
    patch.detail = (data.detail as string | null | undefined) ?? null;
    patch.recoverable = data.recoverable === true;
    if (typeof data.workspacePath === 'string') {
      patch.workspacePath = data.workspacePath;
      patch.baseCommit = (data.baseCommit as string | null | undefined) ?? session.baseCommit;
    }
  } else if (type === 'session.configuration') {
    patch.model = String(data.model ?? session.model);
    if (patch.model !== session.model) patch.usage = { ...session.usage, context: null };
    patch.effort = (data.effort as string | null | undefined) ?? null;
  } else if (type === 'permission.request' || type === 'question.request') {
    patch.status = 'waiting';
    patch.pending = {
      kind: type === 'permission.request' ? 'permission' : 'question',
      requestId: String(data.requestId),
    };
  } else if (type === 'permission.resolved' || type === 'question.resolved') {
    patch.status = 'working';
    patch.pending = null;
  } else if (type === 'deployment.setup') {
    patch.deploymentSetup = (data.state as DeploymentSetup | null | undefined) ?? null;
  } else if (type === 'deployment.configured') {
    patch.deploymentConfigured = Boolean(data.configured);
  } else if (type === 'session.cleared') {
    patch.pending = null;
    patch.usage = { ...session.usage, context: null };
    patch.deploymentSetup = null;
  } else if (type === 'turn.result') {
    patch.status = 'ready';
    patch.pending = null;
  }

  return { ...session, ...patch };
};
