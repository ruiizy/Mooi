import type { TranscriptStep } from '@/features/sessions/types/TranscriptStep';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

/**
 * One ordered slice of an assistant turn. A turn can carry several of these in sequence — text and
 * thinking segments from more than one internal `AssistantMessage`, interleaved with tool steps and
 * delegations to other agents — before `turn.result` closes it (see `applySessionEvent.ts`).
 */
export type TranscriptBlock =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
  | { kind: 'step'; step: TranscriptStep }
  | { kind: 'subagent'; subagent: TranscriptSubagent };
