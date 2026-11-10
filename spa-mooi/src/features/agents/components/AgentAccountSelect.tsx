import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { AgentConnection } from '@/features/agents/types/AgentConnection';
import { useAnchoredPlacement } from '@/shared/hooks/useAnchoredPlacement';

interface AgentAccountSelectProps {
  connections: AgentConnection[];
  value: string;
  onChange: (id: string) => void;
}

const titleFor = (account: AgentConnection) => account.name || account.accountLabel || account.label;

export const AgentAccountSelect = ({ connections, value, onChange }: AgentAccountSelectProps) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const placement = useAnchoredPlacement(open, root);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selected = connections.find((account) => account.id === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const openAt = (index: number) => {
    setOpen(true);
    requestAnimationFrame(() => options.current[index]?.focus());
  };

  return <div ref={root} className="relative">
    <button type="button" aria-label="Agent account" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={listId} onClick={() => open ? setOpen(false) : openAt(Math.max(0, connections.findIndex((entry) => entry.id === value)))}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          openAt(event.key === 'ArrowDown' ? 0 : connections.length - 1);
        }
      }}
      className="flex w-full items-center gap-3 rounded-control border border-line bg-surface-2 px-3 py-2.5 text-left outline-none transition hover:border-line-strong focus-visible:border-brand">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{selected ? titleFor(selected) : 'Select an account'}</span>
        {selected && <span className="block text-xs text-ink-subtle">{selected.label}</span>}
      </span>
      <ChevronDown className={`size-4 shrink-0 text-ink-muted transition ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && createPortal(<div ref={popup} id={listId} role="listbox" aria-label="Agent accounts"
      style={{ position: 'fixed', top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}
      className="z-50 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 shadow-pop">
      {connections.map((account, index) => <button key={account.id} ref={(element) => { options.current[index] = element; }}
        type="button" role="option" aria-selected={account.id === value}
        onClick={() => { onChange(account.id); setOpen(false); root.current?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus(); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); root.current?.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')?.focus(); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            options.current[(index + (event.key === 'ArrowDown' ? 1 : -1) + connections.length) % connections.length]?.focus();
          }
          if (event.key === 'Home') { event.preventDefault(); options.current[0]?.focus(); }
          if (event.key === 'End') { event.preventDefault(); options.current[connections.length - 1]?.focus(); }
        }}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-surface-2 focus:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{titleFor(account)}</span>
          <span className="block text-xs text-ink-subtle">{account.label}</span>
        </span>
        {account.id === value && <Check className="size-4 shrink-0 text-brand" />}
      </button>)}
    </div>, root.current?.closest('dialog') ?? document.body)}
  </div>;
};
