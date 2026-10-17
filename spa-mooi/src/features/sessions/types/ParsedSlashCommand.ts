import type { SlashCommandName } from '@/features/sessions/types/SlashCommandName';

export interface ParsedSlashCommand {
  name: SlashCommandName;
  argument: string;
}
