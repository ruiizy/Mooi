/** Maps epoch milliseconds of a trace onto a 0–100 % track, with round axis ticks. */
export interface TraceTimeScale {
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Position of a time on the track, clamped to 0–100. */
  percent: (ms: number) => number;
  /** Tick offsets from `startMs`, in ms, on a round step (1s, 5s, 1m...). */
  ticks: number[];
}
