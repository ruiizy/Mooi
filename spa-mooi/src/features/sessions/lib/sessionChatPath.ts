import { backupPath, deploymentPath, sessionPath } from '@/app/paths';
import type { Session } from '@/features/sessions/types/Session';

/** Where a session's conversation is read: its own screen, or the chat tab of its platform page. */
export const sessionChatPath = (session: Session): string => {
  if (session.kind === 'production') return `${deploymentPath(session.projectId)}?tab=chat`;
  if (session.kind === 'backup') return `${backupPath(session.projectId)}?tab=chat`;
  return sessionPath(session.projectId, session.id);
};
