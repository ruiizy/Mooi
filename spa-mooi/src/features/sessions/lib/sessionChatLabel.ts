import type { Session } from '@/features/sessions/types/Session';

/** A short name telling conversations apart: the branch of a development session, or its platform. */
export const sessionChatLabel = (session: Session): string => {
  if (session.kind === 'production') return 'Deployment chat';
  if (session.kind === 'backup') return 'Backups chat';
  return session.branch || 'New session';
};
