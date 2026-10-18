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

const countLabels: Record<SubagentStatus, string> = {
  started: 'working',
  working: 'working',
  waiting: 'waiting for you',
  completed: 'done',
  interrupted: 'interrupted',
  failed: 'failed',
};

/** One segment of a fan-out summary: "2 working", "1 waiting for you". */
export const subagentCountLabel = (status: SubagentStatus, count: number): string => `${count} ${countLabels[status]}`;

export const subagentStatusPulses =(status: SubagentStatus): boolean =>
  status === 'started' || status === 'working' || status === 'waiting';
