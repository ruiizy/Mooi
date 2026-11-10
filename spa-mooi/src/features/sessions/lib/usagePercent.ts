import type { UsageMetric } from '@/features/sessions/types/UsageMetric';

/**
 * A metric's share used, 0–100, or null while unknown. A window whose reset already passed starts
 * over empty, the same rule `claude_usage._result` applies server-side, so a row left open across a
 * reset never shows the old window.
 */
export const usagePercent = (metric: UsageMetric | null | undefined, nowSeconds = Date.now() / 1000): number | null => {
  if (typeof metric?.percent !== 'number' || !Number.isFinite(metric.percent)) return null;
  if (metric.resetsAt != null && metric.resetsAt <= nowSeconds) return 0;
  return Math.max(0, Math.min(100, metric.percent));
};
