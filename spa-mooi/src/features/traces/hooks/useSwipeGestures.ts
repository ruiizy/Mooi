import { useEffect, useRef } from 'react';

export type SwipeAxis = 'x' | 'y';

export interface SwipeGestureHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  /** Live offset of the locked axis while the finger moves (e.g. to let a sheet follow it). */
  onDrag?: (axis: SwipeAxis, offset: number) => void;
  /** The gesture ended (swiped or not): reset any `onDrag` offset. */
  onDragEnd?: () => void;
  /** Whether a downward drag may start now (e.g. the sheet's content is scrolled to the top). */
  canSwipeDown?: () => boolean;
  /** Distance in px past which the gesture counts as a swipe. */
  threshold?: number;
}

/** Movement in px before the gesture locks onto one axis. */
const LOCK_PX = 10;

/**
 * Swipe gestures on `element` with pointer events (touch, pen and mouse): after a few pixels the
 * gesture locks onto its dominant axis, so a vertical swipe never also moves horizontally and the
 * other way round. Past `threshold` (60px) on release: left/right fire `onSwipeLeft`/`onSwipeRight`,
 * down fires `onSwipeDown`. Upward drags, and downward ones `canSwipeDown` refuses, are left to the
 * content (scrolling). Taps never lock, so clicks inside keep working. Handlers are read at event time.
 */
export const useSwipeGestures = (element: HTMLElement | null, handlers: SwipeGestureHandlers): void => {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!element) return;
    let gesture: { id: number; x: number; y: number; axis: SwipeAxis | null; ignored: boolean } | null = null;

    const offsetOf = (event: PointerEvent, axis: SwipeAxis) =>
      axis === 'x' ? event.clientX - gesture!.x : event.clientY - gesture!.y;

    const onDown = (event: PointerEvent) => {
      if (gesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null, ignored: false };
    };

    const onMove = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId || gesture.ignored) return;
      if (!gesture.axis) {
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
        const axis: SwipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        const { onSwipeLeft, onSwipeRight, onSwipeDown, canSwipeDown } = latest.current;
        const wanted = axis === 'x'
          ? Boolean(onSwipeLeft || onSwipeRight)
          : dy > 0 && Boolean(onSwipeDown) && (canSwipeDown?.() ?? true);
        if (!wanted) {
          gesture.ignored = true;
          return;
        }
        gesture.axis = axis;
        element.setPointerCapture(event.pointerId);
      }
      const offset = offsetOf(event, gesture.axis);
      latest.current.onDrag?.(gesture.axis, gesture.axis === 'y' ? Math.max(0, offset) : offset);
    };

    const finish = (event: PointerEvent, cancelled: boolean) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const { axis } = gesture;
      const offset = axis ? offsetOf(event, axis) : 0;
      gesture = null;
      if (!axis) return;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      const { onSwipeLeft, onSwipeRight, onSwipeDown, onDragEnd, threshold = 60 } = latest.current;
      onDragEnd?.();
      if (cancelled || Math.abs(offset) < threshold) return;
      if (axis === 'x') (offset < 0 ? onSwipeLeft : onSwipeRight)?.();
      else if (offset > 0) onSwipeDown?.();
    };

    const onUp = (event: PointerEvent) => finish(event, false);
    const onCancel = (event: PointerEvent) => finish(event, true);

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onCancel);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
    };
  }, [element]);
};
