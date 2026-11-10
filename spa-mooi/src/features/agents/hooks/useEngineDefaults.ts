import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchAdminAgentProviders, fetchAgentConnections, fetchEngineDefaults, saveEngineDefaults,
} from '@/features/agents/api/agentsApi';
import type { AdminAgentProvider } from '@/features/agents/types/AdminAgentProvider';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import type { EngineDefaults } from '@/features/agents/types/EngineDefaults';
import { fetchSessionProvider } from '@/features/sessions/api/sessionsApi';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';

export interface CatalogState {
  catalog: SessionProvider | null;
  error: string | null;
  loading: boolean;
}

const catalogKey = (provider: string, adapter: string) => `${provider}:${adapter}`;

/**
 * The platform's agent defaults plus the model catalogs to choose them from. A catalog is read
 * through one of the administrator's own accounts of that provider (their default first), only for
 * the adapter a row shows, and from the cache unless `refresh` asks the provider again.
 */
export const useEngineDefaults = () => {
  const [defaults, setDefaults] = useState<EngineDefaults[]>([]);
  const [providers, setProviders] = useState<Record<string, AdminAgentProvider>>({});
  const [connections, setConnections] = useState<AgentConnection[] | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, CatalogState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchEngineDefaults(),
      // The adapters are optional chrome: without them each row simply offers no adapter choice.
      fetchAdminAgentProviders().catch(() => []),
      fetchAgentConnections().catch(() => []),
    ]).then(([values, registered, accounts]) => {
      if (cancelled) return;
      setDefaults(values);
      setProviders(Object.fromEntries(registered.map((provider) => [provider.id, provider])));
      setConnections(accounts);
    }).catch((failure: Error) => { if (!cancelled) setError(failure.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loadCatalog = useCallback((provider: string, adapter: string, refresh = false) => {
    const key = catalogKey(provider, adapter);
    if (!connections || (!refresh && requested.current.has(key))) return;
    requested.current.add(key);
    setCatalogs((current) => ({ ...current, [key]: { catalog: current[key]?.catalog ?? null, error: null, loading: true } }));
    const accounts = connections.filter((entry) => entry.provider === provider)
      .sort((a, b) => Number(b.defaultAccount) - Number(a.defaultAccount));
    void (async () => {
      let error = 'Connect an account of this provider to list its models.';
      for (const account of accounts) {
        try {
          const catalog = await fetchSessionProvider(provider, account.id, refresh, adapter);
          if (!catalog.unavailable && catalog.models.length) {
            setCatalogs((current) => ({ ...current, [key]: { catalog, error: null, loading: false } }));
            return;
          }
          error = catalog.unavailable || 'No models available.';
        } catch (failure) { error = (failure as Error).message; }
      }
      setCatalogs((current) => ({ ...current, [key]: { catalog: null, error, loading: false } }));
    })();
  }, [connections]);

  const refresh = useCallback(() => {
    for (const key of requested.current) {
      const [provider, adapter] = key.split(':');
      loadCatalog(provider, adapter, true);
    }
  }, [loadCatalog]);

  /** Optimistic: the row shows the choice at once and returns to the stored one if saving fails. */
  const save = useCallback(async (value: EngineDefaults) => {
    let previous: EngineDefaults | undefined;
    setDefaults((current) => current.map((entry) => {
      if (entry.provider !== value.provider) return entry;
      previous = entry;
      return value;
    }));
    try {
      const saved = await saveEngineDefaults(value);
      setDefaults((current) => current.map((entry) => entry.provider === saved.provider ? saved : entry));
    } catch (failure) {
      if (previous) {
        const restored = previous;
        setDefaults((current) => current.map((entry) => entry.provider === restored.provider ? restored : entry));
      }
      throw failure;
    }
  }, []);

  const catalog = useCallback((provider: string, adapter: string): CatalogState | undefined =>
    catalogs[catalogKey(provider, adapter)], [catalogs]);

  return { defaults, providers, loading, error, catalog, loadCatalog, refresh, save,
    refreshing: Object.values(catalogs).some((entry) => entry.loading) };
};
