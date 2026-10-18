import { lazy, Suspense } from 'react';
import { SubagentSection } from './SubagentSection';
import { TranscriptBlockList } from './TranscriptBlockList';
import { isTerminalSubagentStatus } from '@/features/sessions/lib/isTerminalSubagentStatus';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

interface SubagentDetailsProps {
  sessionId: string;
  subagent: TranscriptSubagent;
  showThinking: boolean;
}

const markdown = (text: string) => (
  <div className="max-h-80 overflow-auto rounded-xl border border-line bg-surface-2/50 px-3.5 py-3 text-sm leading-6 text-ink-muted">
    <Suspense fallback={<p className="whitespace-pre-wrap">{text}</p>}><MarkdownContent text={text} /></Suspense>
  </div>
);

/**
 * What a delegation was asked, its own timeline — rendered exactly like the main conversation,
 * nested delegations included — and what it returned. Each part says plainly when unknown.
 */
export const SubagentDetails = ({ sessionId, subagent, showThinking }: SubagentDetailsProps) => {
  const finished = isTerminalSubagentStatus(subagent.status);
  const activityNote = !subagent.streamsActivity
    ? 'This agent’s own activity is not streamed by the provider, only its status and result.'
    : finished ? 'The agent reported no activity.' : 'Waiting for the agent’s first activity…';

  return (
    <div className="flex flex-col gap-6">
      <SubagentSection title="Instructions and context" empty="The provider did not share the instructions sent to this agent.">
        {subagent.prompt ? markdown(subagent.prompt) : undefined}
      </SubagentSection>

      <SubagentSection title="Timeline" empty={activityNote}>
        {subagent.blocks.length ? (
          <TranscriptBlockList sessionId={sessionId} blocks={subagent.blocks} showThinking={showThinking}
            delegatedBy={subagent.agentType ?? 'this subagent'} />
        ) : undefined}
      </SubagentSection>

      <SubagentSection title="Result"
        empty={finished ? 'The agent returned no result.' : 'The result appears here when the agent finishes.'}>
        {subagent.result ? markdown(subagent.result) : undefined}
      </SubagentSection>
    </div>
  );
};
