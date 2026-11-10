import { ChevronDown } from 'lucide-react';

interface ComposerSelectProps {
  value: string;
  /** Options shown; the current value is kept as an extra one when it is not among them. */
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled: boolean;
  ariaLabel: string;
  /** Visible caption beside the picker from `sm`; phones rely on the value alone. */
  caption?: string;
  describedBy?: string;
}

/**
 * A compact picker for the composer toolbar. The native arrow is replaced by a small chevron so two
 * pickers, the microphone and send fit one row on a phone; the native option list still opens.
 */
export const ComposerSelect = ({ value, options, onChange, disabled, ariaLabel, caption, describedBy }: ComposerSelectProps) => (
  <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-subtle">
    {caption ? <span className="hidden sm:inline">{caption}</span> : null}
    <span className="relative flex">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className="max-w-[7.5rem] appearance-none truncate rounded-chip border border-line bg-surface py-1.5 pr-6 pl-2.5 font-medium text-ink shadow-card outline-none transition-colors hover:border-line-strong focus:border-brand disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-[9rem]"
      >
        {value && !options.some((option) => option.value === value) ? <option value={value}>{value}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-ink-subtle" />
    </span>
  </label>
);
