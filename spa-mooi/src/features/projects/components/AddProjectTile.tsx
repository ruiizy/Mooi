import { Plus } from 'lucide-react';

interface AddProjectTileProps {
  onAdd: () => void;
  disabled: boolean;
}

/** The trailing tile of the grid: adding another repository is the only move the grid itself offers. */
export const AddProjectTile = ({ onAdd, disabled }: AddProjectTileProps) => (
  <button
    type="button"
    onClick={onAdd}
    disabled={disabled}
    className="group flex min-h-[196px] flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong px-5 py-8 text-center transition-[border-color,background-color] duration-200 hover:border-brand/50 hover:bg-brand-soft/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50"
  >
    <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-muted shadow-card transition-[transform,color] duration-200 ease-out-expo group-hover:scale-110 group-hover:rotate-90 group-hover:text-brand">
      <Plus className="size-4.5" />
    </span>
    <span className="text-sm font-semibold text-ink">Add another repository</span>
    <span className="max-w-[16rem] text-[11.5px] leading-relaxed text-ink-subtle">
      Only what your GitHub authorisation can reach.
    </span>
  </button>
);
