import type { SubagentStatus } from '@/features/sessions/types/SubagentStatus';

export const isTerminalSubagentStatus = (status: SubagentStatus): boolean =>
  status === 'completed' || status === 'interrupted' || status === 'failed';
