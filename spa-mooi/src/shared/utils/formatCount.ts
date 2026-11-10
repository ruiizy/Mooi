const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * A count short enough for a pill: exact up to 999, then `1.2K`, `12K`, `1.2M`. Pair it with the
 * exact number in a title or label wherever the pill is all the reader sees.
 */
export const formatCount = (value: number): string => (value < 1000 ? String(value) : compact.format(value));
