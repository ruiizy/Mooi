import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ROUTES } from '@/app/routes';
import type { PlayerRole } from '@/features/auth/types/PlayerRole';
import { buttonStyles } from '@/shared/styles/buttonStyles';

interface AccountRoleCardProps {
  role: PlayerRole;
}

export const AccountRoleCard = ({ role }: AccountRoleCardProps) => (
  <section className="relative overflow-hidden rounded-card border border-line bg-surface p-5 shadow-raised">
    <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-brand-soft blur-2xl" />
    <p className="relative font-mono text-[10.5px] font-medium tracking-[0.12em] text-brand-ink uppercase">
      Your role
    </p>
    <p className="relative mt-1.5 text-[22px] font-semibold tracking-[-0.03em] text-ink capitalize">{role}</p>
    <p className="relative mt-2.5 text-[12px] leading-relaxed text-ink-muted">
      Your role was decided when your account was created, from a list the operators maintain. Adding
      an address to that list later does not promote an account that already exists.
    </p>

    {role === 'admin' ? (
      <Link to={ROUTES.admin} className={buttonStyles('brand', 'md', 'mt-4 w-full justify-between')}>
        Go to Admin
        <ChevronRight className="size-4" />
      </Link>
    ) : null}

    <p className="relative mt-3 text-[11px] leading-relaxed text-ink-subtle">
      Access is decided and verified by the server. The interface only reflects what the server allows.
    </p>
  </section>
);
