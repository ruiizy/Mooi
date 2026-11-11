import { AgentProviderIcon } from '@/features/agents/components/AgentProviderIcon';
import type { Session } from '@/features/sessions/types/Session';
import { useAgentsStore } from '@/stores/agentsStore';

interface SessionAccountIdentityProps {
  session: Session;
  compact?: boolean;
}

/** The selected account is the primary identity; the provider adapter (e.g. Claude CLI) explains its type. `compact` is one line. */
export const SessionAccountIdentity = ({ session, compact = false }: SessionAccountIdentityProps) => {
  const connection = useAgentsStore((state) => state.connections.find((item) => item.id === session.connectionId));
  const loading = useAgentsStore((state) => state.status === 'idle' || state.status === 'loading');
  const agent = session.adapterLabel ?? session.providerLabel;
  const name = connection?.name?.trim() || connection?.accountLabel?.trim() || connection?.label || (loading ? 'Loading account…' : 'Account unavailable');

  if (compact) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-ink-subtle" title={`${name} · ${agent}`}>
        <AgentProviderIcon provider={session.provider} className="size-3" />
        <span className="truncate"><span className="font-bold text-ink-muted">{name}</span> · {agent}</span>
      </span>
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-2 leading-tight" title={`${name} · ${agent}`}>
      <AgentProviderIcon provider={session.provider} className="size-4" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-bold text-ink">{name}</span>
        <span className="truncate text-[11px] text-ink-subtle">{agent}</span>
      </span>
    </span>
  );
};
