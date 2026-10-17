import { useCallback, useEffect, useState } from 'react';
import { fetchAgentConnections, fetchEngineDefaults, saveEngineDefaults } from '@/features/agents/api/agentsApi';
import type { EngineDefaults } from '@/features/agents/types/EngineDefaults';
import type { SessionProvider } from '@/features/sessions/types/SessionProvider';
import { fetchSessionProvider } from '@/features/sessions/api/sessionsApi';

export const useEngineDefaults = () => {
  const [defaults, setDefaults] = useState<EngineDefaults[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogs, setCatalogs] = useState<Record<string, SessionProvider>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchEngineDefaults().then((values) => {
      if (!cancelled) { setDefaults(values); setError(null); }
    }).catch((failure: Error) => { if (!cancelled) setError(failure.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    void fetchAgentConnections().then(async (connections) => {
      const results = await Promise.all(['claude', 'codex'].map(async (provider) => {
        let error = 'Connect an account of this engine to browse its available models.';
        for (const connection of connections.filter((entry) => entry.provider === provider).sort((a, b) => Number(b.defaultAccount) - Number(a.defaultAccount))) {
          try {
            const catalog = await fetchSessionProvider(provider, connection.id, true);
            if (!catalog.unavailable && catalog.models.length) return { provider, catalog, error: '' };
            error = catalog.unavailable || 'No models available.';
          } catch (failure) { error = (failure as Error).message; }
        }
        return { provider, catalog: null, error };
      }));
      if (cancelled) return;
      setCatalogs(Object.fromEntries(results.flatMap(({ provider, catalog }) => catalog ? [[provider, catalog]] : [])));
      setCatalogErrors(Object.fromEntries(results.filter(({ error }) => error).map(({ provider, error }) => [provider, error])));
    }).catch((failure: Error) => {
      if (!cancelled) setCatalogErrors({ claude: failure.message, codex: failure.message });
    }).finally(() => { if (!cancelled) setRefreshing(false); });
    return () => { cancelled = true; };
  }, [revision]);

  const save = useCallback(async (value: EngineDefaults) => {
    const saved = await saveEngineDefaults(value);
    setDefaults((current) => current.map((entry) => entry.provider === saved.provider ? saved : entry));
    return saved;
  }, []);

  return { defaults, error, loading, catalogs, catalogErrors, refreshing, save,
    refresh: () => setRevision((value) => value + 1) };
};
