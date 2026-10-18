import type { CollectedSubagent } from '@/features/sessions/types/CollectedSubagent';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

const fromBlocks = (blocks: TranscriptBlock[], parent: TranscriptSubagent | null, depth: number): CollectedSubagent[] =>
  blocks.flatMap((block) => block.kind === 'subagent'
    ? [{ subagent: block.subagent, parent, depth }, ...fromBlocks(block.subagent.blocks, block.subagent, depth + 1)]
    : []);

/**
 * Every delegation of the session in launch order, each followed by those it launched. A detached
 * agent from an earlier turn stays listed: it may still be working.
 */
export const collectSubagents = (entries: TranscriptEntry[]): CollectedSubagent[] =>
  entries.flatMap((entry) => (entry.kind === 'assistant' ? fromBlocks(entry.blocks, null, 0) : []));
