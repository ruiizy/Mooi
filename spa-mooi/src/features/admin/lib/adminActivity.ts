import type { AdminPlayer } from '@/features/admin/types/AdminPlayer';
import type { AdminSession } from '@/features/admin/types/AdminSession';

/** The agent is busy on a turn right now. */
export const isWorking = (session: AdminSession): boolean =>
  session.status === 'working' || session.status === 'compacting';

/** The later of the directory's last sign-in use and a disconnection this view saw live. */
export const lastSeen = (player: AdminPlayer, offlineAt: string | undefined): string | null => {
  if (!offlineAt) return player.lastSeenAt;
  if (!player.lastSeenAt) return offlineAt;
  return Date.parse(offlineAt) > Date.parse(player.lastSeenAt) ? offlineAt : player.lastSeenAt;
};

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad/, 'iOS'], [/Android/, 'Android'], [/Windows/, 'Windows'], [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'], [/Linux/, 'Linux'],
];

/** "Chrome on macOS" from a user agent, enough to recognise a device. */
export const deviceLabel = (userAgent: string | null): string => {
  if (!userAgent) return 'Unknown device';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
};
