import type { AsideStatus } from '@/features/sessions/types/AsideStatus';

/** A side question and its answer; ephemeral, outside the session's conversation. */
export interface Aside {
  id: number;
  sessionId: string;
  question: string;
  answer: string;
  status: AsideStatus;
  error?: string;
}
