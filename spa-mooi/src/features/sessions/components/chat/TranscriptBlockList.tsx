import { useMemo } from 'react';
import { SubagentGroup } from './SubagentGroup';
import { TranscriptContent } from './TranscriptContent';
import { groupTranscriptBlocks } from '@/features/sessions/lib/groupTranscriptBlocks';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import { cn } from '@/shared/utils/cn';

interface TranscriptBlockListProps {
  sessionId: string;
  blocks: TranscriptBlock[];
  showThinking: boolean;
  /** Secondary text size, for an agent's work shown inside a delegation. */
  compact?: boolean;
  /** Null for the main agent's turn; the delegating subagent's name inside a delegation. */
  delegatedBy?: string | null;
}

/**
 * A turn's blocks in the order they happened, with delegations launched together folded into one
 * group. The same list renders a subagent's own timeline in its panel, nested delegations included.
 */
export const TranscriptBlockList = ({ sessionId, blocks, showThinking, compact = false, delegatedBy = null }: TranscriptBlockListProps) => {
  const groups = useMemo(() => groupTranscriptBlocks(blocks), [blocks]);

  return (
    <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2')}>
      {groups.map((group) => {
        if (group.kind === 'subagents') {
          return <SubagentGroup key={group.key} subagents={group.subagents} delegatedBy={delegatedBy} />;
        }
        if (group.block.kind === 'thinking' && !showThinking) return null;
        return <TranscriptContent key={group.key} sessionId={sessionId} block={group.block} compact={compact} />;
      })}
    </div>
  );
};
