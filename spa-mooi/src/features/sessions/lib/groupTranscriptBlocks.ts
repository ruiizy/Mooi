import { transcriptBlockKey } from './transcriptBlockKey';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptBlockGroup } from '@/features/sessions/types/TranscriptBlockGroup';

/**
 * Delegations launched back to back read as one fan-out, so consecutive subagent blocks share a
 * group. Blank text between them (a placeholder the provider later cleared) does not split it.
 */
export const groupTranscriptBlocks = (blocks: TranscriptBlock[]): TranscriptBlockGroup[] => {
  const groups: TranscriptBlockGroup[] = [];

  blocks.forEach((block) => {
    const last = groups[groups.length - 1];
    if (block.kind === 'subagent' && last?.kind === 'subagents') {
      last.subagents.push(block.subagent);
      return;
    }
    if (block.kind === 'subagent') {
      groups.push({ kind: 'subagents', key: transcriptBlockKey(block), subagents: [block.subagent] });
      return;
    }
    if (last?.kind === 'subagents' && block.kind !== 'step' && !block.text.trim()) return;
    groups.push({ kind: 'block', key: transcriptBlockKey(block), block });
  });

  return groups;
};
