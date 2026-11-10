import { useCallback, useEffect, useState } from 'react';
import { fetchAdminPlayers } from '@/features/admin/api/adminApi';
import type { AdminPlayer } from '@/features/admin/types/AdminPlayer';

const SEARCH_DELAY_MS = 250;

/**
 * The user directory, a page at a time, most recently active first. A search waits for typing to
 * pause; actions patch the loaded rows in place instead of reloading the directory.
 */
export const useAdminPlayers = (query: string) => {
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      fetchAdminPlayers(query.trim(), 0).then((page) => {
        if (cancelled) return;
        setPlayers(page.players);
        setTotal(page.total);
        setError(null);
      }).catch((failure: Error) => { if (!cancelled) setError(failure.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, revision === 0 && !query ? 0 : SEARCH_DELAY_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, revision]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    fetchAdminPlayers(query.trim(), players.length).then((page) => {
      // Activity reorders the directory between pages: a user may come up twice.
      setPlayers((current) => {
        const known = new Set(current.map((player) => player.id));
        return [...current, ...page.players.filter((player) => !known.has(player.id))];
      });
      if (page.players.length > 0) setTotal(page.total);
    }).catch((failure: Error) => setError(failure.message))
      .finally(() => setLoadingMore(false));
  }, [query, players.length]);

  const patch = useCallback((playerId: string, change: Partial<AdminPlayer>) => {
    setPlayers((current) => current.map((player) => player.id === playerId ? { ...player, ...change } : player));
  }, []);

  return {
    players, total, loading, loadingMore, error, loadMore, patch,
    hasMore: players.length < total,
    reload: () => setRevision((value) => value + 1),
  };
};
