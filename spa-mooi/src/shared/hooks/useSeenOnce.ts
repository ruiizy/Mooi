import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Turns true the first time the element holding the returned ref comes within `margin` of the
 * viewport, and stays true: for work worth doing only once something is about to be looked at,
 * such as a network read per row of a long list.
 */
export const useSeenOnce = <T extends Element>(margin = '400px') => {
  const [seen, setSeen] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || seen) return;
    observer.current = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.current?.disconnect();
      setSeen(true);
    }, { rootMargin: margin });
    observer.current.observe(node);
  }, [margin, seen]);

  useEffect(() => () => observer.current?.disconnect(), []);

  return { ref, seen };
};
