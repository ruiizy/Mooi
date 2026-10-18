import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

/** A block as it renders: on its own, or a run of delegations launched together. */
export type TranscriptBlockGroup =
  | { kind: 'block'; key: string; block: TranscriptBlock }
  | { kind: 'subagents'; key: string; subagents: TranscriptSubagent[] };
