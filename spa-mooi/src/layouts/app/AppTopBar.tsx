import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import { AppUserMenu } from '@/layouts/app/AppUserMenu';
import { appNavLinks } from '@/layouts/app/appNavLinks';
import { IconButton } from '@/shared/components/IconButton';
import { Logo } from '@/shared/components/Logo';
import { ThemeToggle } from '@/shared/components/ThemeToggle';
import { useImmersiveRoute } from '@/layouts/app/useImmersiveRoute';
import { cn } from '@/shared/utils/cn';
import { useSidebarStore } from '@/stores/sidebarStore';

/** The section the current path belongs to, by the longest matching nav link. */
const useCurrentSection = () => {
  const { pathname } = useLocation();
  return appNavLinks
    .filter((link) => pathname === link.to || pathname.startsWith(`${link.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
};

/**
 * The slim bar every screen sits under.
 *
 * The account menu appears only below `lg` because above it the sidebar user card already owns the
 * player; two account surfaces on one screen would be two places to drift apart. Detail screens
 * (session, deployment, backup) own a header with a back button, so on phones this bar steps aside
 * for them, the way a native navigation stack shows one bar at a time. From `lg` the bar names the
 * current section, so the panel always says where it is.
 */
export const AppTopBar = () => {
  const open = useSidebarStore((state) => state.open);
  const immersive = useImmersiveRoute();
  const section = useCurrentSection();
  const SectionIcon = section?.icon;

  return (
    <header className={cn('sticky top-0 z-30 flex h-14 composing:max-lg:hidden shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-2 backdrop-blur-xl sm:px-4 lg:h-12 lg:bg-canvas lg:px-5 lg:backdrop-blur-none', immersive && 'max-lg:hidden')}>
      <IconButton icon={Menu} label="Open navigation" onClick={open} className="lg:hidden" />

      <Link
        to={ROUTES.projects}
        className="rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand lg:hidden"
      >
        <Logo />
      </Link>

      {section && SectionIcon ? (
        <p className="hidden min-w-0 items-center gap-2 text-[13px] font-medium text-ink-muted lg:flex">
          <SectionIcon className="size-4 shrink-0 text-ink-subtle" />
          <span className="truncate text-ink">{section.label}</span>
        </p>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <span className="lg:hidden">
          <AppUserMenu />
        </span>
      </div>
    </header>
  );
};
