import { useCallback, useEffect, useState } from 'react';
import { fetchSessionFile } from '@/features/sessions/api/sessionsApi';
import type { SessionFileContent } from '@/features/sessions/types/SessionFileContent';
import { useSessionsStore } from '@/stores/sessionsStore';

/**
 * The file open in the editor. It is re-read whenever the live changes summary moves, so an agent
 * edit shows up at once: `behind` is true when the branch holds a newer revision than the one loaded,
 * which the editor adopts silently unless the user has unsaved edits of their own.
 */
export const useOpenFile = (sessionId: string, path: string, active: boolean) => {
  const changes = useSessionsStore((state) => state.byId[sessionId]?.changes);
  const [file, setFile] = useState<SessionFileContent | null>(null);
  const [latest, setLatest] = useState<SessionFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchSessionFile(sessionId, path)
      .then((next) => {
        if (cancelled) return;
        setError(null);
        setLatest(next);
        setFile((current) => current ?? next);
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(failure.message);
      });
    return () => {
      cancelled = true;
    };
  }, [active, attempt, changes, path, sessionId]);

  /** Makes the freshest read the loaded one, dropping any stale view of the file. */
  const adopt = useCallback((next?: SessionFileContent) => {
    const adopted = next ?? latest;
    if (!adopted) return;
    setFile(adopted);
    setLatest(adopted);
  }, [latest]);

  const reload = useCallback(() => {
    setFile(null);
    setError(null);
    setAttempt((current) => current + 1);
  }, []);

  const behind = file !== null && latest !== null && latest.revision !== file.revision;

  return { file, latest, error, behind, adopt, reload };
};
