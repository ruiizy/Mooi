import type { SessionUsage } from './SessionUsage';
import type { DeploymentSnapshot } from './DeploymentSnapshot';
import type { DeploymentSetup } from './DeploymentSetup';
import type { AgentCapabilities } from '@/features/sessions/types/AgentCapabilities';
import type { PendingRequest } from '@/features/sessions/types/PendingRequest';
import type { SessionKind } from '@/features/sessions/types/SessionKind';
import type { SessionStatus } from '@/features/sessions/types/SessionStatus';
import type { SessionSubagents } from '@/features/sessions/types/SessionSubagents';

export interface Session {
  id: string;
  kind: SessionKind;
  projectId: string;
  projectFullName: string;
  provider: string;
  connectionId: string;
  model: string;
  effort?: string | null;
  providerLabel: string;
  branch: string;
  baseBranch: string;
  status: SessionStatus;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
  usage?: SessionUsage;
  pending: PendingRequest | null;
  capabilities: AgentCapabilities;
  deployment: DeploymentSnapshot;
  deploymentSetup?: DeploymentSetup | null;
  /** The workspace holds a root Compose file, so its deployment setup can be changed. */
  deploymentConfigured?: boolean;
  /** The session's own clone on the sessions pod; null until provisioning has cloned it. */
  workspacePath: string | null;
  baseCommit: string | null;
  /** Failed with its agent and workspace intact: reconnecting resumes the conversation. */
  recoverable?: boolean;
  /** Delegated agents still working or waiting on the player; absent from older servers. */
  subagents?: SessionSubagents;
}
