const pad = (value: number) => String(value).padStart(2, '0');

/** A duration as `820ms`, `4.2s`, `42s`, `3m 05s` or `1h 02m`. */
export const formatSpanDuration = (ms: number): string => {
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(Math.floor(value / 100) / 10).toFixed(1)}s`;
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
};
