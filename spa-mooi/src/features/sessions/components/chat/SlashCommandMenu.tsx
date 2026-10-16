import type { SlashCommand } from '@/features/sessions/types/SlashCommand';
import { slashCommandOptionId } from '@/features/sessions/lib/slashCommandOptionId';
import { cn } from '@/shared/utils/cn';

interface SlashCommandMenuProps {
  id: string;
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

/** Commands matching the draft's `/…`; keyboard focus stays in the textarea (see `aria-activedescendant`). */
export const SlashCommandMenu = ({ id, commands, activeIndex, onPick, onHover }: SlashCommandMenuProps) => (
  <ul id={id} role="listbox" aria-label="Commands"
    className="absolute inset-x-1.5 bottom-full z-50 mb-2 max-h-[min(16rem,40dvh)] animate-menu-in overflow-y-auto rounded-xl border border-line-strong bg-surface p-1.5 shadow-[0_12px_32px_rgb(0_0_0/0.2)] dark:shadow-[0_12px_32px_rgb(0_0_0/0.6)]">
    {commands.map((command, index) => {
      const Icon = command.icon;
      return (
        <li key={command.name} id={slashCommandOptionId(id, index)} role="option" aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(command)}
          onMouseEnter={() => onHover(index)}
          className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
            index === activeIndex ? 'bg-surface-2 text-ink' : 'text-ink-muted')}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[0.8rem] font-semibold text-ink">/{command.name}</span>
            <span className="block truncate text-xs">{command.description}</span>
          </span>
        </li>
      );
    })}
  </ul>
);
