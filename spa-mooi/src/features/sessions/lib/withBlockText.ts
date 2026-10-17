import { isProviderPlaceholder } from './isProviderPlaceholder';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';

const matches = (block: TranscriptBlock, kind: 'text' | 'thinking', id: string) =>
  block.kind === kind && block.id === id;

/**
 * Appends (`*.delta`) or replaces (`*.message`, the provider's authoritative final text) one
 * text/thinking block. An empty final block drops any provisional placeholder from the deltas.
 */
export const withBlockText = (
  blocks: TranscriptBlock[],
  kind: 'text' | 'thinking',
  id: string,
  text: string,
  mode: 'append' | 'replace',
): TranscriptBlock[] => {
  const empty = !text.trim() || (kind === 'text' && isProviderPlaceholder(text));
  if (mode === 'replace' && empty) return blocks.filter((block) => !matches(block, kind, id));
  if (!text) return blocks;

  const index = blocks.findIndex((block) => matches(block, kind, id));
  const current = blocks[index];
  if (current && (current.kind === 'text' || current.kind === 'thinking')) {
    const next = { ...current, text: mode === 'append' ? current.text + text : text };
    return blocks.map((block, i) => (i === index ? next : block));
  }
  return [...blocks, { kind, id, text }];
};
