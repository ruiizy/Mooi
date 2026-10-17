import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { AppNavItem } from '@/layouts/app/AppNavItem';
import { AppRecentProject } from '@/layouts/app/AppRecentProject';
import { AppSidebarUser } from '@/layouts/app/AppSidebarUser';
import { appNavLinks } from '@/layouts/app/appNavLinks';
import { recentProjects } from '@/layouts/app/recentProjects';
import { Eyebrow } from '@/shared/components/Eyebrow';
import { IconButton } from '@/shared/components/IconButton';
import { Logo } from '@/shared/components/Logo';
import { cn } from '@/shared/utils/cn';
import { useAuthStore } from '@/stores/authStore';
import { useProjectsStore } from '@/stores/projectsStore';
import { useSessionsStore } from '@/stores/sessionsStore';

interface AppSidebarProps {
  className?: string;
  onNavigate?: () => void;
}

/** Quiet projects shown at most; projects with open conversations are always listed on top. */
const SIDEBAR_PROJECTS = 6;

export const AppSidebar = ({ className, onNavigate }: AppSidebarProps) => {
  const player = useAuthStore((state) => state.player);
  const projects = useProjectsStore((state) => state.projects);
  const sessions = useSessionsStore((state) => state.sessions);
  const links = appNavLinks.filter((link) => !link.adminOnly || player?.role === 'admin');
  const sidebarProjects = useMemo(() => recentProjects(projects, sessions, SIDEBAR_PROJECTS), [projects, sessions]);

  return (
    <aside className={cn('flex flex-col bg-canvas', className)}>
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <Link
          to={ROUTES.projects}
          onClick={onNavigate}
          className="rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          <Logo />
        </Link>
        {onNavigate ? <IconButton icon={X} label="Close navigation" onClick={onNavigate} /> : null}
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pt-2">
        {links.map((link) => (
          <AppNavItem key={link.id} link={link} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* Only rendered once there is a workspace: an empty heading would promise a list that the
          player has not created yet. */}
      {sidebarProjects.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-8 pb-3">
          <Eyebrow className="px-3">Recent</Eyebrow>
          <div className="mt-2 flex flex-col gap-0.5">
            {sidebarProjects.map((entry) => (
              <AppRecentProject key={entry.project.id} entry={entry} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <AppSidebarUser onNavigate={onNavigate} />
    </aside>
  );
};
