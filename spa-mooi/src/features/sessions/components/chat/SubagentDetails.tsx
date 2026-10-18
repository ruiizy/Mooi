import { lazy, Suspense, type ReactNode } from 'react';
import { SubagentSection } from './SubagentSection';
import { isTerminalSubagentStatus } from '@/features/sessions/lib/isTerminalSubagentStatus';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

interface SubagentDetailsProps {
  subagent: TranscriptSubagent;
  /** Renders the agent's own blocks; nested delegations name this agent as their delegator. */
  renderActivity: (blocks: TranscriptBlock[], delegatedBy: string) => ReactNode;
}

const markdown = (text: string) => (
  <div className="max-h-72 overflow-auto rounded-lg border border-line bg-canvas/60 px-3 py-2.5 text-[13px] leading-6 text-ink-muted">
    <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}><MarkdownContent text={text} /></Suspense>
  </div>
);

/** What a delegation was asked, what it did and what it returned — each said plainly when unknown. */
export const SubagentDetails = ({ subagent, renderActivity }: SubagentDetailsProps) => {
  const finished = isTerminalSubagentStatus(subagent.status);
  const activityNote = !subagent.streamsActivity
    ? 'This agent’s own activity is not streamed by the provider, only its status and result.'
    : finished ? 'The agent reported no activity.' : 'Waiting for the agent’s first activity…';

  return (
    <div className="flex flex-col gap-4">
      <SubagentSection title="Instructions and context" empty="The provider did not share the instructions sent to this agent.">
        {subagent.prompt ? markdown(subagent.prompt) : undefined}
      </SubagentSection>

      <SubagentSection title="Activity" empty={activityNote}>
        {subagent.blocks.length ? renderActivity(subagent.blocks, subagent.agentType ?? 'subagent') : undefined}
      </SubagentSection>

      <SubagentSection title="Result"
        empty={finished ? 'The agent returned no result.' : 'The result appears here when the agent finishes.'}>
        {subagent.result ? markdown(subagent.result) : undefined}
      </SubagentSection>
    </div>
  );
};
