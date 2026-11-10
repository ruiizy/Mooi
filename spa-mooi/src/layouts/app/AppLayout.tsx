import { useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { useAgentConnectionsSync } from '@/features/agents/hooks/useAgentConnectionsSync';
import { useGithubConnectionSync } from '@/features/github/hooks/useGithubConnectionSync';
import { useLiveChannelSync } from '@/features/live/hooks/useLiveChannelSync';
import { useProjectsSync } from '@/features/projects/hooks/useProjectsSync';
import { useRecipeMarketplacesSync } from '@/features/recipes/hooks/useRecipeMarketplacesSync';
import { AppMobileDrawer } from '@/layouts/app/AppMobileDrawer';
import { AppSidebar } from '@/layouts/app/AppSidebar';
import { AppTopBar } from '@/layouts/app/AppTopBar';
import { usePageTransition } from '@/layouts/app/usePageTransition';
import { useScrollTopOnNavigate } from '@/layouts/app/useScrollTopOnNavigate';

/**
 * The frame: a sidebar on the shell color and, from `lg`, the content panel laid on it as a
 * rounded sheet. The ambient glow sits on the frame, which never scrolls, so it is painted once.
 */
export const AppLayout = () => {
  useGithubConnectionSync();
  useProjectsSync();
  useAgentConnectionsSync();
  useRecipeMarketplacesSync();
  useLiveChannelSync();
  const main = useRef<HTMLElement>(null);
  useScrollTopOnNavigate(main);
  usePageTransition(main);

  return (
    <div className="relative isolate flex h-full overflow-hidden bg-canvas pt-(--safe-top) pr-(--safe-right) pl-(--safe-left) text-ink lg:bg-shell">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden lg:block [background:radial-gradient(60rem_30rem_at_12%_-10%,var(--glow-a),transparent_70%),radial-gradient(50rem_28rem_at_100%_0%,var(--glow-b),transparent_70%)]" />
      <AppSidebar className="hidden w-[252px] shrink-0 lg:flex" />

      <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas lg:rounded-panel lg:border lg:border-line lg:shadow-raised">
          <AppTopBar />
          <main ref={main} className="min-h-0 flex-1 overflow-y-auto bg-canvas">
            <Outlet />
          </main>
        </div>
      </div>

      <AppMobileDrawer />
    </div>
  );
};
