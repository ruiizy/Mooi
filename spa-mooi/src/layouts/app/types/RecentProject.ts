import type { Project } from '@/features/projects/types/Project';
import type { Session } from '@/features/sessions/types/Session';

/** One project of the sidebar's Recent section with the conversations it still has open. */
export interface RecentProject {
  project: Project;
  sessions: Session[];
}
