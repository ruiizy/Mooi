import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProductionDeployments } from '@/features/production/api/productionHistoryApi';
import type { ProductionDeployment } from '@/features/production/types/ProductionDeployment';
import { useLiveStore } from '@/stores/liveStore';

/** Every project's persisted deployments, reloaded whenever the live channel reports one ended. */
export const useProductionDeployments = (enabled: boolean) => {
  const finished = useLiveStore((state) => state.finished.production);
  const [deployments, setDeployments] = useState<ProductionDeployment[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const removed = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await fetchProductionDeployments(0);
        if (!active) return;
        setDeployments((current) => {
          const visible = result.deployments.filter((item) => !removed.current.has(item.operationId));
          if (page === 0) return visible;
          const latest = new Set(visible.map((item) => item.operationId));
          return [...visible, ...current.filter((item) => !latest.has(item.operationId) && !removed.current.has(item.operationId))];
        });
        if (page === 0) setHasMore(result.hasMore);
        setError(null);
      } catch (failure) {
        if (active) setError((failure as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    };
    setLoading(true);
    void refresh();
    return () => { active = false; };
  }, [enabled, revision, page, finished]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const result = await fetchProductionDeployments(page + 1);
      setDeployments((current) => {
        const seen = new Set(current.map((item) => item.operationId));
        return [...current, ...result.deployments.filter((item) => !seen.has(item.operationId) && !removed.current.has(item.operationId))];
      });
      setPage((current) => current + 1);
      setHasMore(result.hasMore);
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page]);

  return { deployments, loading, error, hasMore, loadMore,
    remove: (operationId: string) => { removed.current.add(operationId); setDeployments((current) => current.filter((item) => item.operationId !== operationId)); },
    reload: () => setRevision((value) => value + 1) };
};
