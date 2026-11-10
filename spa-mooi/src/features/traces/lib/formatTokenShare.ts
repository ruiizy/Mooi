/** A part of a whole as a percentage label: `42%`, `<1%` for tiny non-zero parts, `0%` otherwise. */
export const formatTokenShare = (part: number, whole: number): string => {
  if (whole <= 0 || part <= 0) return '0%';
  const percent = (part / whole) * 100;
  return percent < 1 ? '<1%' : `${Math.round(percent)}%`;
};
