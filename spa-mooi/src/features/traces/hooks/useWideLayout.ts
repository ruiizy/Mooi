import { useEffect, useState } from 'react';

/** The `lg` breakpoint (64rem) the trace layout switches on: inspector pane beside the timeline. */
const WIDE_QUERY = '(min-width: 64rem)';

/** Whether the viewport is at least `lg` wide, kept current as the window resizes or rotates. */
export const useWideLayout = (): boolean => {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return wide;
};
