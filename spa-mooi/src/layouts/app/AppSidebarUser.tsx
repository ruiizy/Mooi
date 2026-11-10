import { AppUserMenu } from '@/layouts/app/AppUserMenu';

interface AppSidebarUserProps {
  onNavigate?: () => void;
}

/**
 * The foot of the rail: the account menu in its full, name/avatar/email shape.
 */
export const AppSidebarUser = ({ onNavigate }: AppSidebarUserProps) => (
  <div className="shrink-0 p-3">
    <div className="rounded-xl border border-line bg-surface/70 p-1 shadow-card">
      <AppUserMenu variant="full" onNavigate={onNavigate} />
    </div>
  </div>
);
