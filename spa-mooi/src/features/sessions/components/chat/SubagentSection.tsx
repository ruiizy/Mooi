import type { ReactNode } from 'react';

interface SubagentSectionProps {
  title: string;
  /** Shown instead of the content when the provider did not report it. */
  empty: string;
  children?: ReactNode;
}

/** One part of an expanded delegation; says plainly when there is nothing to show. */
export const SubagentSection = ({ title, empty, children }: SubagentSectionProps) => (
  <section className="flex flex-col gap-1.5">
    <h4 className="text-[10px] font-extrabold tracking-[0.08em] text-ink-subtle uppercase">{title}</h4>
    {children ?? <p className="text-xs text-ink-subtle italic">{empty}</p>}
  </section>
);
