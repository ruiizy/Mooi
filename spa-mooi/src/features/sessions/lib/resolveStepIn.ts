import type { ImageAttachment } from '@/features/sessions/types/ImageAttachment';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

interface StepOutcome {
  isError: boolean;
  summary: string;
  images: ImageAttachment[];
}

/**
 * The delegating call returned. A foreground delegation ends with it and its result is the agent's
 * report; a detached one keeps working, so only a failure to start it ends it here.
 */
const settleDelegation = (subagent: TranscriptSubagent, outcome: StepOutcome): TranscriptSubagent => {
  // The agent's own report outranks what the call returned; the call outranks a summary.
  const result = subagent.resultSource !== 'report' && outcome.summary
    ? { result: outcome.summary, resultSource: 'call' as const } : {};
  if (subagent.detached) {
    return outcome.isError ? { ...subagent, ...result, status: 'failed' } : subagent;
  }
  return { ...subagent, ...result, status: outcome.isError ? 'failed' : 'completed' };
};

/** Resolves the step or delegation with `toolUseId`, searching nested delegations; null if absent. */
export const resolveStepIn = (blocks: TranscriptBlock[], toolUseId: string, outcome: StepOutcome): TranscriptBlock[] | null => {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    let next: TranscriptBlock | null = null;

    if (block.kind === 'step' && block.step.toolUseId === toolUseId) {
      next = { kind: 'step', step: { ...block.step, status: outcome.isError ? 'failed' : 'done',
        summary: outcome.summary, images: outcome.images } };
    } else if (block.kind === 'subagent' && block.subagent.toolUseId === toolUseId) {
      next = { kind: 'subagent', subagent: settleDelegation(block.subagent, outcome) };
    } else if (block.kind === 'subagent') {
      const nested = resolveStepIn(block.subagent.blocks, toolUseId, outcome);
      next = nested ? { kind: 'subagent', subagent: { ...block.subagent, blocks: nested } } : null;
    }

    if (next) return blocks.map((item, index) => (index === i ? next : item));
  }
  return null;
};
