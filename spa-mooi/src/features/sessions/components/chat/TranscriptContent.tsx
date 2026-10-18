import { isProviderPlaceholder } from '@/features/sessions/lib/isProviderPlaceholder';
import { lazy, memo, Suspense } from 'react';
import { AgentStepItem } from './AgentStepItem';
import { ImageGenerationCard } from './ImageGenerationCard';
import { ThinkingBlock } from './ThinkingBlock';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import { cn } from '@/shared/utils/cn';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

interface TranscriptContentProps {
  sessionId: string;
  block: TranscriptBlock;
  /** Secondary text size, for an agent's work shown inside a delegation. */
  compact?: boolean;
}

/**
 * One text, thinking or step block. Unchanged blocks retain their identity during streaming and
 * skip expensive Markdown parsing. Delegations render as groups in `TranscriptBlockList`.
 */
export const TranscriptContent = memo(function TranscriptContent({ sessionId, block, compact = false }: TranscriptContentProps) {
  if (block.kind === 'subagent') return null;
  if (block.kind === 'step' && block.step.name === 'ImageGeneration') return <ImageGenerationCard sessionId={sessionId} step={block.step} />;
  if (block.kind === 'step') return <AgentStepItem sessionId={sessionId} step={block.step} />;
  if (!block.text.trim() || isProviderPlaceholder(block.text)) return null;
  if (block.kind === 'thinking') return <ThinkingBlock text={block.text} />;
  return (
    <div className={cn('min-w-0 break-words', compact ? 'text-[13px] leading-6 text-ink-muted' : 'text-[15px] leading-7 text-ink')}>
      <Suspense fallback={<span className="whitespace-pre-wrap">{block.text}</span>}>
        <MarkdownContent text={block.text} />
      </Suspense>
    </div>
  );
});
