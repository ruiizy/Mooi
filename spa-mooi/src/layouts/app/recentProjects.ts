import type { Project } from '@/features/projects/types/Project';
import type { Session } from '@/features/sessions/types/Session';
import type { RecentProject } from '@/layouts/app/types/RecentProject';

/**
 * Projects with open conversations always make the list, ahead of the rest and never cut by the
 * limit; quiet projects only fill what is left of it. Both keep the store's order, so a project
 * does not jump around while its agent works.
 */
export const recentProjects = (projects: Project[], sessions: Session[], limit: number): RecentProject[] => {
  const open = sessions.filter((session) => session.status !== 'closed');
  const entries = projects.map((project) => ({
    project,
    sessions: open.filter((session) => session.projectId === project.id),
  }));
  const active = entries.filter((entry) => entry.sessions.length > 0);
  const quiet = entries.filter((entry) => entry.sessions.length === 0);

  return [...active, ...quiet.slice(0, Math.max(0, limit - active.length))];
};
