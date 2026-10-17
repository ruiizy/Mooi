import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

type Update = (subagent: TranscriptSubagent) => TranscriptSubagent;

/**
 * Applies `update` to the delegation with `toolUseId`, wherever it sits — including inside another
 * delegation. Returns null when no such delegation exists, so callers can fall back.
 */
export const updateSubagentIn = (blocks: TranscriptBlock[], toolUseId: string, update: Update): TranscriptBlock[] | null => {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block.kind !== 'subagent') continue;
    const next = block.subagent.toolUseId === toolUseId
      ? update(block.subagent)
      : (() => {
        const nested = updateSubagentIn(block.subagent.blocks, toolUseId, update);
        return nested ? { ...block.subagent, blocks: nested } : null;
      })();
    if (next) return blocks.map((item, index) => (index === i ? { kind: 'subagent', subagent: next } : item));
  }
  return null;
};
