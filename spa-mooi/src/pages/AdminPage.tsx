import { useSearchParams } from 'react-router-dom';
import { Bot, Users } from 'lucide-react';
import { AdminUsersPanel } from '@/features/admin/components/AdminUsersPanel';
import { AdminAgentDefaults } from '@/features/agents/components/AdminAgentDefaults';
import { Tabs } from '@/shared/components/Tabs';

const USERS_TAB = 'users';
const AGENTS_TAB = 'agents';
const TABS = new Set([USERS_TAB, AGENTS_TAB]);

/**
 * The platform console. The active section lives in `?tab=` so a reload lands back on it; each
 * section mounts only while shown, so the live user directory streams only while it is open.
 */
export const AdminPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab = requested && TABS.has(requested) ? requested : USERS_TAB;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 pt-7 pb-[calc(1.75rem+var(--safe-bottom))] sm:px-8 lg:px-10 lg:pt-10 lg:pb-10">
      <header>
        <p className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-subtle uppercase">Platform</p>
        <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.04em] text-ink sm:text-[34px]">Admin</h1>
        <p className="mt-1.5 text-sm text-ink-muted">Follow who uses the platform live and set its defaults.</p>
      </header>

      <Tabs
        ariaLabel="Admin sections"
        value={tab}
        onChange={(next) => setSearchParams(next === USERS_TAB ? {} : { tab: next }, { replace: true })}
        className="-mb-2 border-b border-line"
        items={[
          { id: USERS_TAB, label: 'Users', icon: Users },
          { id: AGENTS_TAB, label: 'Agents', icon: Bot },
        ]}
      />

      {tab === AGENTS_TAB ? <AdminAgentDefaults /> : <AdminUsersPanel />}
    </div>
  );
};
