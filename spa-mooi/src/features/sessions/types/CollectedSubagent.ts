import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

/** A delegation anywhere in the session, with how deep in other delegations it was launched. */
export interface CollectedSubagent {
  subagent: TranscriptSubagent;
  depth: number;
}
