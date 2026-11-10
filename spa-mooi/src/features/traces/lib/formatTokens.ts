import { formatCount } from '@/shared/utils/formatCount';

/** A token count for a pill or a cell: `820`, `12K`, `1.2M`; `–` when unknown. */
export const formatTokens = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '–' : formatCount(Math.max(0, Math.round(value)));
