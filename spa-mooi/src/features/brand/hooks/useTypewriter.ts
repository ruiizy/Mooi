import { useEffect, useState } from 'react';

/** Reveals `text` one character at a time. Remount (key) the caller to restart it. */
export const useTypewriter = (text: string, intervalMs = 24): string => {
  const [count, setCount] = useState(0);
  const done = count >= text.length;

  useEffect(() => {
    if (done) return;
    const timer = window.setInterval(() => {
      setCount((current) => Math.min(current + 1, text.length));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [done, text.length, intervalMs]);

  return text.slice(0, count);
};
