import type { TraceTimeScale } from '@/features/traces/types/TraceTimeScale';

const steps = [
  100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
  1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000,
];

/**
 * The time axis of the waterfall from `startMs` to `endMs` (epoch ms), with about `tickCount` ticks on
 * the smallest round step that keeps them apart. An empty range gets one second, so bars never divide by 0.
 */
export const traceTimeScale = (startMs: number, endMs: number, tickCount = 5): TraceTimeScale => {
  const durationMs = Math.max(1000, endMs - startMs);
  const target = durationMs / Math.max(1, tickCount);
  const step = steps.find((candidate) => candidate >= target) ?? Math.ceil(target / 86_400_000) * 86_400_000;
  const ticks: number[] = [];
  for (let offset = 0; offset <= durationMs; offset += step) {
    ticks.push(offset);
  }
  return {
    startMs,
    endMs: startMs + durationMs,
    durationMs,
    percent: (ms) => Math.min(100, Math.max(0, ((ms - startMs) / durationMs) * 100)),
    ticks,
  };
};
