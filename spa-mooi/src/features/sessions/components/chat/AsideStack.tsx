import { useEffect, useRef } from 'react';
import type { Aside } from '@/features/sessions/types/Aside';
import { AsideCard } from './AsideCard';

interface AsideStackProps {
  asides: Aside[];
  onDismiss: (id: number) => void;
}

/** Side questions float above the composer, beside a turn that keeps running. */
export const AsideStack = ({ asides, onDismiss }: AsideStackProps) => {
  const listRef = useRef<HTMLUListElement>(null);
  const newest = asides.at(-1)?.id;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [newest]);

  if (asides.length === 0) return null;

  return (
    <section aria-label="Side questions" aria-live="polite" className="mx-auto w-full max-w-[60rem] shrink-0 px-2.5 pt-2 sm:px-8">
      <ul ref={listRef} className="flex max-h-[min(22rem,38dvh)] flex-col gap-2 overflow-y-auto overscroll-contain">
        {asides.map((aside) => <AsideCard key={aside.id} aside={aside} onDismiss={onDismiss} />)}
      </ul>
    </section>
  );
};
