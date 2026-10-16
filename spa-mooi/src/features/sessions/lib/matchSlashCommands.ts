import { slashCommands } from '@/features/sessions/lib/slashCommands';
import type { SlashCommand } from '@/features/sessions/types/SlashCommand';

/** Commands the draft is still typing (`/`, `/b`…); none once a space or newline follows. */
export const matchSlashCommands = (text: string, available: SlashCommand[] = slashCommands): SlashCommand[] => {
  const match = /^\/([a-z]*)$/.exec(text);
  return match ? available.filter((command) => command.name.startsWith(match[1])) : [];
};
