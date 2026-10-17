import type { SubagentStatus } from '@/features/sessions/types/SubagentStatus';
import type { Tone } from '@/shared/types/Tone';

const tones: Record<SubagentStatus, Tone> = {
  started: 'neutral',
  working: 'info',
  waiting: 'warning',
  completed: 'success',
  interrupted: 'neutral',
  failed: 'danger',
};

const labels: Record<SubagentStatus, string> = {
  started: 'Started',
  working: 'Working',
  waiting: 'Waiting for you',
  completed: 'Completed',
  interrupted: 'Interrupted',
  failed: 'Failed',
};

export const subagentStatusTone = (status: SubagentStatus): Tone => tones[status];

export const subagentStatusLabel = (status: SubagentStatus): string => labels[status];

export const subagentStatusPulses = (status: SubagentStatus): boolean =>
  status === 'started' || status === 'working' || status === 'waiting';
