import { useState } from 'react';
import { Bot, Pencil, Plus, RefreshCw, Star, TriangleAlert, Unlink } from 'lucide-react';
import { AddAgentAccountDialog } from '@/features/agents/components/AddAgentAccountDialog';
import { useAgentConnections } from '@/features/agents/hooks/useAgentConnections';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Modal } from '@/shared/components/Modal';
import { iconAction } from '@/shared/styles/iconAction';
import { cn } from '@/shared/utils/cn';

const accountTitle = (connection: AgentConnection) => connection.name || connection.accountLabel || connection.label;

export const AgentConnectionsCard = () => {
  const { providers, connections, status, error, busy, actionError, startOauth, connectToken,
    disconnect, rename, setDefaultAccount, reload, clearActionError } = useAgentConnections();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AgentConnection | null>(null);
  const [name, setName] = useState('');

  return <Card className="p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-extrabold tracking-[-0.02em] text-ink">Agent accounts</h2>
        <p className="mt-1 text-xs text-ink-subtle">Set the account preselected for new agent sessions.</p>
      </div>
      <Button variant="secondary" size="sm" disabled={busy || providers.length === 0}
        onClick={() => { clearActionError(); setAdding(true); }}>
        <Plus className="size-4" /> Add account
      </Button>
    </div>

    {status === 'error' && <div className="mt-5 flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-sm text-danger">{error}</p>
      <Button variant="secondary" size="sm" onClick={reload}><RefreshCw className="size-4" /> Try again</Button>
    </div>}

    {status === 'loading' && connections.length === 0 && <div className="mt-5 space-y-3 animate-pulse-soft">
      {[0, 1].map((index) => <div key={index} className="h-16 rounded-xl bg-surface-2" />)}
    </div>}

    {status === 'ready' && connections.length === 0 && <div className="mt-5 rounded-xl border border-dashed border-line px-5 py-8 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-surface-2 text-ink-muted"><Bot className="size-5" /></span>
      <p className="mt-3 text-sm font-semibold text-ink">No agent accounts yet</p>
      <p className="mt-1 text-xs text-ink-muted">Add a Claude or Codex account to start a session.</p>
    </div>}

    {connections.length > 0 && <ul className="mt-5 divide-y divide-line rounded-xl border border-line px-4 sm:px-5">
      {connections.map((connection) => <li key={connection.id} className="flex items-center gap-3 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted"><Bot className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{accountTitle(connection)}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-subtle">
            {connection.label}
            {connection.defaultAccount && <span className="font-semibold text-brand">Default</span>}
            {connection.stale && <span className="inline-flex items-center gap-1 text-warning"><TriangleAlert className="size-3" /> Needs attention</span>}
          </p>
        </div>
        {/* Icon actions keep the account name readable on phones; the labels live in title and aria-label. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" aria-label={`${connection.defaultAccount ? 'Clear default account' : `Use ${accountTitle(connection)} by default`}`}
            title={connection.defaultAccount ? 'Clear default account' : 'Use by default'} aria-pressed={connection.defaultAccount}
            disabled={busy} className={cn(iconAction, connection.defaultAccount && 'text-brand')}
            onClick={() => void setDefaultAccount(connection.defaultAccount ? null : connection.id)}>
            <Star className={cn('size-4', connection.defaultAccount && 'fill-current')} />
          </button>
          <button type="button" aria-label={`Rename ${accountTitle(connection)}`} title="Rename" disabled={busy} className={iconAction}
            onClick={() => { clearActionError(); setEditing(connection); setName(connection.name || accountTitle(connection)); }}>
            <Pencil className="size-4" />
          </button>
          <button type="button" aria-label={`Disconnect ${accountTitle(connection)}`} title="Disconnect" disabled={busy}
            className={cn(iconAction, 'border-danger/35 text-danger hover:bg-danger-soft hover:text-danger')}
            onClick={() => void disconnect(connection.id)}>
            <Unlink className="size-4" />
          </button>
        </div>
      </li>)}
    </ul>}

    {actionError && !adding && !editing && <p role="alert" className="mt-4 text-sm text-danger">{actionError}</p>}

    {adding && <AddAgentAccountDialog providers={providers} busy={busy} actionError={actionError}
      onClose={() => setAdding(false)} onConnected={reload} onConnectToken={connectToken} onStartOauth={startOauth} />}

    <Modal open={editing !== null} onClose={() => setEditing(null)} title="Rename account"
      description="Choose a title to recognize this account."
      footer={<>
        <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        <Button variant="brand" disabled={busy || !name.trim()} onClick={() => {
          if (editing) void rename(editing.id, name.trim()).then((success) => { if (success) setEditing(null); });
        }}>Save</Button>
      </>}>
      <label className="flex flex-col gap-2 text-xs font-semibold text-ink-muted">Account title
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required autoFocus
          className="h-12 rounded-[10px] border border-line bg-surface-2 px-3 text-sm text-ink outline-none focus:border-brand" />
      </label>
      {editing && actionError && <p role="alert" className="mt-3 text-sm text-danger">{actionError}</p>}
    </Modal>
  </Card>;
};
