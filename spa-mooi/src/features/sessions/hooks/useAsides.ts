import { useCallback, useEffect, useRef, useState } from 'react';
import { askAside } from '@/features/sessions/api/sessionsApi';
import type { Aside } from '@/features/sessions/types/Aside';

const KEPT_ASIDES = 3;

/** Side questions of one session: streamed answers that live only in this view. */
export const useAsides = (sessionId: string) => {
  const [asides, setAsides] = useState<Aside[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const nextId = useRef(0);

  useEffect(() => {
    const running = controllers.current;
    return () => {
      running.forEach((controller) => controller.abort());
      running.clear();
    };
  }, [sessionId]);

  const ask = useCallback(async (question: string) => {
    const id = ++nextId.current;
    const controller = new AbortController();
    const update = (change: (aside: Aside) => Partial<Aside>) =>
      setAsides((current) => current.map((aside) => (aside.id === id ? { ...aside, ...change(aside) } : aside)));
    controllers.current.set(id, controller);
    setAsides((current) => [
      ...current.filter((aside) => aside.sessionId === sessionId).slice(-(KEPT_ASIDES - 1)),
      { id, sessionId, question, answer: '', status: 'answering' },
    ]);

    try {
      await askAside(sessionId, question, (text) => update((aside) => ({ answer: aside.answer + text })), controller.signal);
      update(() => ({ status: 'answered' }));
    } catch (error) {
      if (controller.signal.aborted) return;
      update(() => ({ status: 'failed', error: error instanceof Error ? error.message : 'Could not ask the side question.' }));
    } finally {
      controllers.current.delete(id);
    }
  }, [sessionId]);

  const dismiss = useCallback((id: number) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setAsides((current) => current.filter((aside) => aside.id !== id));
  }, []);

  const visible = asides.filter((aside) => aside.sessionId === sessionId);

  return { asides: visible, answering: visible.some((aside) => aside.status === 'answering'), ask, dismiss };
};
