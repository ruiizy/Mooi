import { useState } from 'react';
import { useDeployment } from '@/features/sessions/hooks/useDeployment';
import { deploymentConsoleHidden } from '@/features/sessions/lib/deploymentConsoleHidden';
import type { DeployControl } from '@/features/sessions/types/DeployControl';
import type { Session } from '@/features/sessions/types/Session';
import { useSessionsStore } from '@/stores/sessionsStore';

/**
 * Deploy the session's root Docker Compose as a live preview, and stop it again. Until the project's
 * setup passed its test through the agent (a root Compose file alone does not count), with no root
 * Compose file, or after a failed start, Deploy clears the chat and the agent sets the deployment up
 * there, ending with a test run; the console stays hidden while it prepares. Otherwise Deploy runs
 * directly, and the setup can be changed with the user's request; only while the deployment is
 * stopped. Null until the session reports a deployment.
 */
export const useDeployControl = (session: Session, disabled: boolean): DeployControl | null => {
  const { deployment, busy, error, start, stop, changeSetup } = useDeployment(session.id);
  const [setupOpen, setSetupOpen] = useState(false);
  const logOpen = useSessionsStore((store) => store.byId[session.id]?.deploymentLogOpen ?? false);
  const hasLog = useSessionsStore((store) => Boolean(store.byId[session.id]?.deploymentLog.length));
  if (!deployment) return null;

  const { state, cleanupRequired, result, phase } = deployment;
  const starting = state === 'starting';
  const stopping = state === 'stopping';
  const canStop = starting || state === 'running' || (state === 'failed' && cleanupRequired);
  const preparing = !canStop && session.deploymentSetup === 'preparing'
    && (session.status === 'working' || session.status === 'waiting');
  const label = stopping ? 'Stopping…' : starting ? 'Deploying…' : preparing ? 'Preparing…' : canStop ? 'Stop'
    : state === 'failed' ? 'Retry' : 'Deploy';
  const failure = error ?? result?.reason?.message ?? null;
  const idleRequest = session.status !== 'ready' || Boolean(session.pending);
  const loading = busy || starting || stopping || preparing;

  return {
    label,
    hint: preparing ? 'The agent is preparing the deployment in the chat'
      : failure ?? (starting ? `${phase ?? 'Preparing the deployment'}\nClick to cancel.` : stopping ? phase : null),
    failure: preparing ? null : failure,
    blocked: disabled || busy || stopping || session.status === 'closed' || (!canStop && idleRequest),
    canStop,
    starting,
    loading,
    active: loading || canStop,
    withLogs: (hasLog || Boolean(deployment.operationId)) && !deploymentConsoleHidden(session),
    logOpen,
    withSetup: Boolean(session.deploymentConfigured),
    setupBlocked: disabled || busy || canStop || stopping || preparing || idleRequest,
    setupOpen,
    busy,
    error,
    run: () => void (canStop ? stop() : start()),
    toggleLogs: () => useSessionsStore.getState().setDeploymentLogOpen(session.id, !logOpen),
    openSetup: () => setSetupOpen(true),
    closeSetup: () => setSetupOpen(false),
    submitSetup: (instructions) => void changeSetup(instructions).then((sent) => { if (sent) setSetupOpen(false); }),
  };
};
