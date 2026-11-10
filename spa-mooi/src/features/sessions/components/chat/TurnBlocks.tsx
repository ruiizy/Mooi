import { lazy, memo, Suspense } from 'react';
import { ActivityGroup } from './ActivityGroup';
import { ImageGenerationCard } from './ImageGenerationCard';
import { SubagentCard } from './SubagentCard';
import { groupTurnBlocks } from '@/features/sessions/lib/groupTurnBlocks';
import { isTerminalSubagentStatus } from '@/features/sessions/lib/isTerminalSubagentStatus';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

interface TurnBlocksProps {
  sessionId: string;
  blocks: TranscriptBlock[];
  showThinking: boolean;
  /** The agent is working on these blocks right now (not finished, not waiting on the user). */
  live: boolean;
  /** When the work started, for the live elapsed counter. */
  since?: string;
  /** Who delegated the subagents among these blocks: the main agent unless nested in another delegation. */
  delegatedBy?: string;
}

/** Unchanged text keeps its identity while the turn streams, so Markdown is parsed only when it changes. */
const AssistantText = memo(function AssistantText({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words text-[15px] leading-7 text-ink">
      <Suspense fallback={<span className="whitespace-pre-wrap">{text}</span>}>
        <MarkdownContent text={text} />
      </Suspense>
    </div>
  );
});

/** A delegated agent is busy on its own work while it has started or is working, not while it asks. */
const subagentBusy = (subagent: TranscriptSubagent): boolean => subagent.status === 'started' || subagent.status === 'working';

/**
 * The ordered work of one agent (see `groupTurnBlocks`): its messages stand on their own, what it
 * does in between folds into activity blocks, and each delegation is a card that nests the
 * delegated agent's own work the same way. While live, the open block — or a fresh one once the
 * agent has spoken — names what it is doing; a running delegation already says so itself.
 */
export const TurnBlocks = ({ sessionId, blocks, showThinking, live, since, delegatedBy = 'main agent' }: TurnBlocksProps) => {
  const segments = groupTurnBlocks(blocks, showThinking);
  const last = segments[segments.length - 1];
  const waitingOnDelegate = last?.kind === 'subagent' && !isTerminalSubagentStatus(last.subagent.status);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <AssistantText key={segment.key} text={segment.block.text} />;
        if (segment.kind === 'image') return <ImageGenerationCard key={segment.key} sessionId={sessionId} step={segment.step} />;
        if (segment.kind === 'subagent') {
          const { subagent } = segment;
          return (
            <SubagentCard key={segment.key} subagent={subagent} delegatedBy={delegatedBy}
              renderBlocks={(nested, parent) => (
                <TurnBlocks sessionId={sessionId} blocks={nested} showThinking={showThinking}
                  live={subagent.streamsActivity && subagentBusy(subagent)} delegatedBy={parent} />
              )} />
          );
        }
        return <ActivityGroup key={segment.key} sessionId={sessionId} blocks={segment.blocks} since={since}
          active={live && index === segments.length - 1} />;
      })}
      {/* Once the agent has spoken, its next step opens a new block before any tool shows up. */}
      {live && last?.kind !== 'activity' && !waitingOnDelegate ? (
        <ActivityGroup sessionId={sessionId} blocks={[]} since={since} active />
      ) : null}
    </>
  );
};
