import type { DeploymentState } from '@/features/sessions/types/DeploymentState';
import type { SessionKind } from '@/features/sessions/types/SessionKind';
import type { SessionStatus } from '@/features/sessions/types/SessionStatus';

/** A live chat of any user, as mic-sessions streams it to administrators: no transcript or usage. */
export interface AdminSession {
  id: string;
  playerId: string;
  kind: SessionKind;
  projectId: string;
  projectFullName: string;
  branch: string;
  providerLabel: string;
  adapterLabel: string;
  model: string;
  effort: string | null;
  status: SessionStatus;
  /** The agent waits for an answer from its user. */
  pending: boolean;
  deploymentState: DeploymentState;
  createdAt: string;
  updatedAt: string;
}
