import { isTerminalSubagentStatus } from './isTerminalSubagentStatus';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';

/**
 * A turn that ends cannot leave work pending inside it: a step without a result failed, and a
 * foreground delegation still running was interrupted. Detached agents outlive the turn.
 */
export const settleTurnBlocks = (blocks: TranscriptBlock[]): TranscriptBlock[] => blocks.map((block) => {
  if (block.kind === 'step' && block.step.status === 'running') {
    return { ...block, step: { ...block.step, status: 'failed', summary: 'Turn ended before a tool result was received.' } };
  }
  if (block.kind === 'subagent' && !block.subagent.detached) {
    const { subagent } = block;
    return { kind: 'subagent', subagent: { ...subagent, blocks: settleTurnBlocks(subagent.blocks),
      status: isTerminalSubagentStatus(subagent.status) ? subagent.status : 'interrupted' } };
  }
  return block;
});
