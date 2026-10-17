import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';

export const transcriptBlockKey = (block: TranscriptBlock): string => {
  if (block.kind === 'step') return `step-${block.step.toolUseId}`;
  if (block.kind === 'subagent') return `subagent-${block.subagent.toolUseId}`;
  return `${block.kind}-${block.id}`;
};
