/**
 * One bar of the Insights context chart: a model request (or, on long traces, the largest request of a
 * bucket of `calls` consecutive ones). Token parts stack bottom-up: cache read, cache write, new input,
 * then output.
 */
export interface TraceContextBar {
  spanId: string;
  /** 1-based position of the request among the charted requests. */
  index: number;
  /** Requests this bar stands for (1 unless bucketed). */
  calls: number;
  model?: string;
  startMs: number;
  cacheRead: number;
  cacheWrite: number;
  input: number;
  output: number;
  /** Prompt size of the request: cache read + cache write + input. */
  context: number;
  /** The request ran inside a sub-agent. */
  subAgent: boolean;
}
