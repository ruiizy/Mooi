import { useEffect, useState } from 'react';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import { fetchSessionProvider } from '@/features/sessions/api/sessionsApi';
import { defaultEffortFor } from '@/features/sessions/lib/defaultEffortFor';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';

export interface AgentModelChoice {
  connections: AgentConnection[];
  connectionId: string;
  setConnectionId: (value: string) => void;
  provider: string;
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
 * The agent account, model and effort a dialog starts an agent with. Only linked providers are
 * offered: an unlinked one cannot start a session, so the picker never lists a choice the request
 * would immediately reject. The catalog reloads whenever the dialog opens or the account changes.
 */
export const useAgentModelChoice = (open: boolean, connections: AgentConnection[]): AgentModelChoice => {
  const [connectionId, setConnectionId] = useState('');
  const [catalog, setCatalog] = useState<{ connectionId: string; provider: SessionProvider } | null>(null);
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const selectedConnection = connections.find((entry) => entry.id === connectionId);
  const provider = selectedConnection?.provider ?? '';
  const selectedProvider = catalog?.connectionId === connectionId && catalog.provider.id === provider
    ? catalog.provider : undefined;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalog(null);
    setCatalogError(null);
    if (!provider) return;
    void fetchSessionProvider(provider, connectionId).then((entry) => {
      if (!cancelled) setCatalog({ connectionId, provider: entry });
    }).catch((failure: Error) => {
      if (!cancelled) setCatalogError(failure.message);
    });
    return () => { cancelled = true; };
  }, [open, connectionId, provider]);

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
    setConnectionId((current) => (current && connections.some((connection) => connection.id === current)
      ? current : connections.find((connection) => connection.defaultAccount)?.id ?? connections[0]?.id ?? ''));
  }, [open, connections]);

  const selectModel = (value: string) => {
    setModel(value);
    setEffort(defaultEffortFor(selectedProvider, value));
  };

  const ready = connections.length > 0 && provider.length > 0 && connectionId.length > 0
    && Boolean(selectedProvider?.models.some((entry) => entry.id === model)) && !selectedProvider?.unavailable;

  return { connections, connectionId, setConnectionId, provider, selectedProvider, model, effort, selectModel,
    setEffort, catalogError, ready };
};
