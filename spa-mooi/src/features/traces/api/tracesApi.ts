import { sessionsFetch } from '@/features/sessions/lib/sessionsFetch';
import type { AgentTrace } from '@/features/traces/types/AgentTrace';
import type { TraceLogFile } from '@/features/traces/types/TraceLogFile';
import type { TraceSpanDetail } from '@/features/traces/types/TraceSpanDetail';
import { apiErrorMessage } from '@/shared/utils/apiErrorMessage';

const tracePath = (sessionId: string, revision?: string) =>
  `/sessions/${sessionId}/trace${revision ? `?revision=${encodeURIComponent(revision)}` : ''}`;
const spanPath = (sessionId: string, spanId: string) =>
  `/sessions/${sessionId}/trace/spans/${encodeURIComponent(spanId)}`;

/** The session's trace, or `null` when it has not changed since `revision` (`204`). */
export const fetchTrace = async (sessionId: string, revision?: string): Promise<AgentTrace | null> => {
  const response = await sessionsFetch(tracePath(sessionId, revision));

  if (response.status === 204) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load the trace.'));
  }

  return (await response.json()) as AgentTrace;
};

export const fetchTraceSpan = async (sessionId: string, spanId: string): Promise<TraceSpanDetail> => {
  const response = await sessionsFetch(spanPath(sessionId, spanId));

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not load this step.'));
  }

  return (await response.json()) as TraceSpanDetail;
};

const FALLBACK_LOG_NAME = 'mooi-trace-log';

/** `filename="…"` of a `Content-Disposition` header (exposed by the sessions service's CORS). */
const dispositionFilename = (header: string | null): string | null => {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : null;
};

/** The raw agent session logs the trace is built from (one file as-is, several as one `.zip`). */
export const downloadTraceLogs = async (sessionId: string): Promise<TraceLogFile> => {
  const response = await sessionsFetch(`/sessions/${sessionId}/trace/logs`);

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, 'Could not download the agent log.'));
  }

  return {
    blob: await response.blob(),
    filename: dispositionFilename(response.headers.get('Content-Disposition')) ?? FALLBACK_LOG_NAME,
  };
};
