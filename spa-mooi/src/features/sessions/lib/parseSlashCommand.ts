import { slashCommands } from '@/features/sessions/lib/slashCommands';
import type { ParsedSlashCommand } from '@/features/sessions/types/ParsedSlashCommand';

/** A known command at the start of the draft; any other `/text` stays an ordinary message. */
export const parseSlashCommand = (text: string): ParsedSlashCommand | null => {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const command = match ? slashCommands.find((candidate) => candidate.name === match[1]) : undefined;
  return command ? { name: command.name, argument: (match?.[2] ?? '').trim() } : null;
};
