import { describeStep } from '@/features/sessions/lib/describeStep';
import type { StepKind } from '@/features/sessions/lib/describeStep';
import { isProviderPlaceholder } from '@/features/sessions/lib/isProviderPlaceholder';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptStep } from '@/features/sessions/types/TranscriptStep';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

export type ActivityBlock = Extract<TranscriptBlock, { kind: 'thinking' | 'step' }>;

/**
 * How a turn reads: what the agent says to the user stands on its own, and everything it does in
 * between — thinking, tool calls, commands — folds into one activity block. Each message the agent
 * writes closes the block before it; the next action opens a new one (as in Codex and Claude Code).
 * A generated image is output, not activity, so it also stands on its own, and so does a
 * delegation to another agent: its own work nests inside it, never in the main agent's activity.
 */
export type TurnSegment =
  | { kind: 'text'; key: string; block: Extract<TranscriptBlock, { kind: 'text' }> }
  | { kind: 'image'; key: string; step: TranscriptStep }
  | { kind: 'activity'; key: string; blocks: ActivityBlock[] }
  | { kind: 'subagent'; key: string; subagent: TranscriptSubagent };

export const blockKey = (block: TranscriptBlock): string => {
  if (block.kind === 'step') return `step-${block.step.toolUseId}`;
  if (block.kind === 'subagent') return `subagent-${block.subagent.toolUseId}`;
  return `${block.kind}-${block.id}`;
};

export const groupTurnBlocks = (blocks: TranscriptBlock[], showThinking: boolean): TurnSegment[] => {
  const segments: TurnSegment[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') {
      if (block.text.trim() && !isProviderPlaceholder(block.text)) segments.push({ kind: 'text', key: blockKey(block), block });
      continue;
    }
    if (block.kind === 'subagent') {
      segments.push({ kind: 'subagent', key: blockKey(block), subagent: block.subagent });
      continue;
    }
    if (block.kind === 'thinking' && (!showThinking || !block.text.trim())) continue;
    if (block.kind === 'step' && block.step.name === 'ImageGeneration') {
      segments.push({ kind: 'image', key: blockKey(block), step: block.step });
      continue;
    }
    const last = segments[segments.length - 1];
    // A group keeps the key of its first block, so it keeps its identity (and open state) as it grows.
    if (last?.kind === 'activity') last.blocks = [...last.blocks, block];
    else segments.push({ kind: 'activity', key: blockKey(block), blocks: [block] });
  }
  return segments;
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Explored 3 files, 2 searches · Edited 1 file · Ran 2 commands": what a finished block did. */
export const summarizeActivity = (blocks: ActivityBlock[]): { text: string; failed: number } => {
  const files = { read: new Set<string>(), edit: new Set<string>() };
  const counts: Partial<Record<StepKind, number>> = {};
  let thoughts = 0;
  let failed = 0;

  for (const block of blocks) {
    if (block.kind === 'thinking') {
      thoughts += 1;
      continue;
    }
    const description = describeStep(block.step);
    if (block.step.status === 'failed') failed += 1;
    if ((description.kind === 'read' || description.kind === 'edit') && description.target) {
      files[description.kind].add(description.target);
    } else {
      counts[description.kind] = (counts[description.kind] ?? 0) + 1;
    }
  }

  const reads = files.read.size + (counts.read ?? 0);
  const explored = [
    reads ? plural(reads, 'file') : null,
    counts.search ? plural(counts.search, 'search', 'searches') : null,
    counts.list ? plural(counts.list, 'list') : null,
  ].filter(Boolean);
  const edits = files.edit.size + (counts.edit ?? 0);
  const parts = [
    explored.length ? `Explored ${explored.join(', ')}` : null,
    edits ? `Edited ${plural(edits, 'file')}` : null,
    counts.command ? `Ran ${plural(counts.command, 'command')}` : null,
    counts.web ? `Searched the web${counts.web > 1 ? ` ${counts.web}×` : ''}` : null,
    counts.agent ? `Delegated ${plural(counts.agent, 'task')}` : null,
    counts.plan ? 'Updated plan' : null,
    counts.image ? `Viewed ${plural(counts.image, 'image')}` : null,
    counts.tool ? `Used ${plural(counts.tool, 'tool')}` : null,
  ].filter(Boolean);

  return { text: parts.length ? parts.join(' · ') : thoughts ? 'Thought' : 'Worked', failed };
};
