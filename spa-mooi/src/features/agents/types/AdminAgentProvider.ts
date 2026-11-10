import type { AgentAdapter } from '@/features/sessions/types/AgentAdapter';

/** A provider as mic-sessions registers it: its adapters, the first of which is its built-in default. */
export interface AdminAgentProvider {
  id: string;
  label: string;
  adapters: AgentAdapter[];
}
