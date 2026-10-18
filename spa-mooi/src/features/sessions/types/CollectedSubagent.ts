import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

/** A delegation anywhere in the session, with the delegation that launched it, if any. */
export interface CollectedSubagent {
  subagent: TranscriptSubagent;
  parent: TranscriptSubagent | null;
  depth: number;
}
