import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadTraceLogs } from '@/features/traces/api/tracesApi';
import { saveBlob } from '@/features/traces/lib/saveBlob';

interface TraceLogDownload {
  download: () => void;
  downloading: boolean;
  error: string | null;
  dismissError: () => void;
}

/**
 * Downloads the raw agent session logs behind a session's trace through the authenticated sessions
 * client (the token never goes into a URL). One download at a time; an error stays until dismissed or
 * the next attempt.
 */
export const useTraceLogDownload = (sessionId: string): TraceLogDownload => {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const download = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setDownloading(true);
    setError(null);
    downloadTraceLogs(sessionId)
      .then(({ blob, filename }) => {
        if (mounted.current) saveBlob(blob, filename);
      })
      .catch((reason: unknown) => {
        if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not download the agent log.');
      })
      .finally(() => {
        busy.current = false;
        if (mounted.current) setDownloading(false);
      });
  }, [sessionId]);

  const dismissError = useCallback(() => setError(null), []);

  return { download, downloading, error, dismissError };
};
