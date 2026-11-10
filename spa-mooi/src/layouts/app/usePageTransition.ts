import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A new screen fades up into place. Driven by the Web Animations API on the existing container, so
 * nothing remounts (screens keep their state and streams) and only opacity and transform change,
 * which the compositor handles without layout or paint.
 */
export const usePageTransition = (container: RefObject<HTMLElement | null>): void => {
  const { pathname } = useLocation();
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const element = container.current;
    if (!element || reducedMotion() || typeof element.animate !== 'function') return;
    const animation = element.animate(
      [{ opacity: 0.001, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
    return () => animation.cancel();
  }, [container, pathname]);
};
