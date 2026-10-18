import { useSyncExternalStore } from 'react';

/** Whether a media query matches right now, kept in sync as the viewport changes. */
export const useMediaQuery = (query: string): boolean => useSyncExternalStore(
  (onChange) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  },
  () => window.matchMedia(query).matches,
  () => false,
);
