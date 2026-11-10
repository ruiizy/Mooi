/** Suggests the next minor version after the newest semantic tag (patch reset to 0), keeping its `v` prefix. */
export const nextReleaseTag = (latest: string | undefined): string => {
  const match = latest?.match(/^(v?)(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return latest ? '' : 'v1.0.0';
  return `${match[1]}${match[2]}.${Number(match[3]) + 1}.0`;
};
