import { isProviderPlaceholder } from '@/features/sessions/lib/isProviderPlaceholder';
import { lazy, memo, Suspense } from 'react';
import { AgentStepItem } from './AgentStepItem';
import { ImageGenerationCard } from './ImageGenerationCard';
import { SubagentCard } from './SubagentCard';
import { ThinkingBlock } from './ThinkingBlock';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

/** Unchanged blocks retain their identity during streaming and skip expensive Markdown parsing. */
interface TranscriptContentProps {
  sessionId: string;
  block: TranscriptBlock;
  /** Who delegated a subagent block: the main agent unless nested in another delegation. */
  delegatedBy?: string;
}

export const TranscriptContent = memo(function TranscriptContent({ sessionId, block, delegatedBy = 'main agent' }: TranscriptContentProps) {
  if (block.kind === 'subagent') {
    return <SubagentCard subagent={block.subagent} delegatedBy={delegatedBy}
      renderBlock={(nested, parent) => <TranscriptContent sessionId={sessionId} block={nested} delegatedBy={parent} />} />;
  }
  if (block.kind === 'step' && block.step.name === 'ImageGeneration') return <ImageGenerationCard sessionId={sessionId} step={block.step} />;
  if (block.kind === 'step') return <AgentStepItem sessionId={sessionId} step={block.step} />;
  if (!block.text.trim() || isProviderPlaceholder(block.text)) return null;
  if (block.kind === 'thinking') return <ThinkingBlock text={block.text} />;
  return (
    <div className="min-w-0 break-words text-[15px] leading-7 text-ink">
      <Suspense fallback={<span className="whitespace-pre-wrap">{block.text}</span>}>
        <MarkdownContent text={block.text} />
      </Suspense>
    </div>
  );
});
