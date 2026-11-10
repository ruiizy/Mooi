import { useCallback, useEffect, useState } from 'react';
import { fetchBackups } from '@/features/backups/api/backupHistoryApi';
import type { Backup } from '@/features/backups/types/Backup';
import { useLiveStore } from '@/stores/liveStore';

/** Every recorded backup across projects, newest first, reloaded whenever the live channel reports an operation ended. */
export const useBackups = () => {
  const finished = useLiveStore((state) => state.finished.backup);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [pages, setPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = () => Promise.all(Array.from({ length: pages }, (_, page) => fetchBackups(page)))
      .then((results) => {
        if (!active) return;
        const seen = new Set<string>();
        setBackups(results.flatMap((result) => result.backups).filter((backup) => !seen.has(backup.id) && seen.add(backup.id)));
        setHasMore(results[results.length - 1]?.hasMore ?? false);
        setError(null);
      })
      .catch((failure: Error) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    setLoading(true);
    void refresh();
    return () => { active = false; };
  }, [pages, revision, finished]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const loadMore = useCallback(() => setPages((value) => value + 1), []);

  return { backups, hasMore, loading, error, reload, loadMore };
};
