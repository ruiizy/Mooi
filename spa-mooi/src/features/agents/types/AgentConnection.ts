import type { AgentConnectionMode } from '@/features/agents/types/AgentConnectionMode';

/**
 * An agent-provider credential linked to the signed-in player, exactly as the API reports it.
 *
 * No token material of any kind: the browser never needs the credential itself, so it is never
 * given one. `stale` is `true` when an OAuth credential expired and refresh failed — the player
 * repairs it with one click, the row is not deleted.
 */
export interface AgentConnection {
  id: string;
  provider: string;
  label: string;
  name: string | null;
  mode: AgentConnectionMode;
  accountLabel: string | null;
  scope: string | null;
  connectedAt: string;
  expiresAt: string | null;
  stale: boolean;
  defaultAccount: boolean;
}
