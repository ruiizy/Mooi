import { collectSubagents } from '@/features/sessions/lib/collectSubagents';
import { isSubagentTool } from '@/features/sessions/lib/isSubagentTool';
import type { Session } from '@/features/sessions/types/Session';
import type { SessionEvent } from '@/features/sessions/types/SessionEvent';
import type { SessionTranscriptState } from '@/features/sessions/types/SessionTranscriptState';

const changesCounts = (event: SessionEvent): boolean =>
  event.type.startsWith('subagent.') || event.type === 'tool.result' || event.type === 'turn.result'
  || event.type === 'session.cleared' || (event.type === 'tool.use' && isSubagentTool(String(event.data.name)));

/**
 * An open session's transcript folds its delegations event by event, so it is fresher than the
 * counts the last list fetch carried: while a stream is live, the row follows the transcript.
 * A transcript with no delegations leaves the server's counts alone.
 */
export const withLiveSubagents = (session: Session, transcript: SessionTranscriptState, event: SessionEvent): Session => {
  if (!changesCounts(event)) return session;
  const all = collectSubagents(transcript.entries).map(({ subagent }) => subagent.status);
  if (!all.length && event.type !== 'session.cleared') return session;
  const waiting = all.filter((status) => status === 'waiting').length;
  const working = all.filter((status) => status === 'started' || status === 'working').length;
  return session.subagents?.waiting === waiting && session.subagents.working === working
    ? session : { ...session, subagents: { working, waiting } };
};
