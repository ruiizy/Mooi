import { Search } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}

export const SearchInput = ({ value, onChange, placeholder, className }: SearchInputProps) => (
  <div
    className={cn(
      'flex h-10 w-full items-center gap-2.5 rounded-control border border-line bg-surface px-3 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus-within:border-brand/60 focus-within:ring-4 focus-within:ring-brand/12',
      className,
    )}
  >
    <Search className="size-4 shrink-0 text-ink-subtle" />
    <input
      type="search"
      autoCapitalize="none"
      autoCorrect="off"
      enterKeyHint="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="h-full w-full min-w-0 bg-transparent text-sm font-medium text-ink placeholder:text-ink-subtle focus:outline-none"
    />
  </div>
);
