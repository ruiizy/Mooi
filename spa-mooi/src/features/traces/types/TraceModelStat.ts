/** Model requests of the trace grouped by model (sub-agent requests included). */
export interface TraceModelStat {
  model: string;
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}
