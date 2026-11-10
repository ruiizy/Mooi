import { useEffect, useState } from 'react';

/**
 * The current time, ticking every `intervalMs` while `running` (spans still open), so running spans'
 * durations and waterfall bars grow on screen; frozen otherwise, so a finished trace never re-renders.
 */
export const useTraceClock = (running: boolean, intervalMs = 1000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, running]);

  return now;
};
