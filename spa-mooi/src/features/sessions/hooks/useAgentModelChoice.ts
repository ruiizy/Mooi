import { useEffect, useMemo, useState } from 'react';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import { fetchSessionProvider } from '@/features/sessions/api/sessionsApi';
import { defaultEffortFor } from '@/features/sessions/lib/defaultEffortFor';
import type { AgentAdapter } from '@/features/sessions/types/AgentAdapter';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';

export interface AgentModelChoice {
  connections: AgentConnection[];
  connectionId: string;
  setConnectionId: (value: string) => void;
  provider: string;
  /** The provider's implementations; a picker is offered only when there is more than one. */
  adapters: AgentAdapter[];
  /** The selected adapter, empty until the catalog names the provider's default. */
  adapter: string;
  setAdapter: (value: string) => void;
  selectedProvider: SessionProvider | undefined;
  model: string;
  effort: string;
  selectModel: (value: string) => void;
  setEffort: (value: string) => void;
  catalogError: string | null;
  /** An account, an available provider and one of its models are selected. */
  ready: boolean;
}

/**
 * The agent account, adapter, model and effort a dialog starts an agent with. Only linked providers are
 * offered: an unlinked one cannot start a session, so the picker never lists a choice the request
 * would immediately reject. The catalog reloads whenever the dialog opens or the account or adapter
 * changes: each adapter reports its own models. An adapter choice survives an account switch within
 * the same provider and falls back to the provider's default otherwise.
 */
export const useAgentModelChoice = (open: boolean, connections: AgentConnection[]): AgentModelChoice => {
  // A stale row is retained on the account page so it can be reconnected in place, but it is not a
  // usable session choice. In particular, an old default must never win over a newer valid account.
  const availableConnections = useMemo(
    () => connections.filter((connection) => !connection.stale), [connections],
  );
  const [connectionId, setConnectionId] = useState('');
  const [requestedAdapter, setRequestedAdapter] = useState('');
  const [catalog, setCatalog] = useState<{ connectionId: string; adapter: string; provider: SessionProvider } | null>(null);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const selectedConnection = availableConnections.find((entry) => entry.id === connectionId);
  const provider = selectedConnection?.provider ?? '';
  const selectedProvider = catalog?.connectionId === connectionId && catalog.adapter === requestedAdapter
    && catalog.provider.id === provider ? catalog.provider : undefined;
  const adapters = selectedProvider?.adapters ?? [];
  const adapter = selectedProvider?.adapter ?? requestedAdapter;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalog(null);
    setCatalogError(null);
    if (!provider) return;
    void fetchSessionProvider(provider, connectionId, false, requestedAdapter || undefined).then((entry) => {
      if (!cancelled) setCatalog({ connectionId, adapter: requestedAdapter, provider: entry });
    }).catch((failure: Error) => {
      if (!cancelled) setCatalogError(failure.message);
    });
    return () => { cancelled = true; };
  }, [open, connectionId, provider, requestedAdapter]);

  useEffect(() => {
    if (!open) setRequestedAdapter('');
  }, [open]);

  useEffect(() => {
    // Another provider has other adapters: start from its default.
    setRequestedAdapter('');
  }, [provider]);

  useEffect(() => {
    const defaultModel = selectedProvider?.defaultModel ?? '';
    setModel(defaultModel);
    setEffort(defaultEffortFor(selectedProvider, defaultModel));
  }, [selectedProvider]);

  useEffect(() => {
    if (!open) {
      setConnectionId('');
      return;
    }
    setConnectionId((current) => (current && availableConnections.some((connection) => connection.id === current)
      ? current : availableConnections.find((connection) => connection.defaultAccount)?.id
        ?? availableConnections[0]?.id ?? ''));
  }, [open, availableConnections]);

  const selectModel = (value: string) => {
    setModel(value);
    setEffort(defaultEffortFor(selectedProvider, value));
  };

  const ready = availableConnections.length > 0 && provider.length > 0 && connectionId.length > 0
    && Boolean(selectedProvider?.models.some((entry) => entry.id === model)) && !selectedProvider?.unavailable;

  return { connections: availableConnections, connectionId, setConnectionId, provider, adapters,
    adapter, setAdapter: setRequestedAdapter,
    selectedProvider, model, effort, selectModel, setEffort, catalogError, ready };
};
