/** The full content of one span, fetched on demand (each text capped by the backend). */
export interface TraceSpanDetail {
  id: string;
  input: string | null;
  output: string | null;
  metadata: Record<string, unknown>;
}
