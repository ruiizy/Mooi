import type { LucideIcon } from 'lucide-react';
import type { SlashCommandName } from '@/features/sessions/types/SlashCommandName';

export interface SlashCommand {
  name: SlashCommandName;
  description: string;
  icon: LucideIcon;
  /** Takes text after the name, so picking it inserts `/name ` instead of running it. */
  takesArgument: boolean;
}
