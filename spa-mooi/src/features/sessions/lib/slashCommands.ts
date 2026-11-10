import { Eraser, Minimize2, MessageCircleQuestion } from 'lucide-react';
import type { SlashCommand } from '@/features/sessions/types/SlashCommand';

export const slashCommands: SlashCommand[] = [
  { name: 'btw', description: 'Ask a side question without interrupting the agent', icon: MessageCircleQuestion, takesArgument: true },
  // Instructions are optional: picking it inserts `/compact `, and sending it bare compacts as usual.
  { name: 'compact', description: 'Summarize the conversation to free context, optionally saying what to keep', icon: Minimize2, takesArgument: true },
  { name: 'clear', description: 'Start a fresh conversation, keeping the workspace', icon: Eraser, takesArgument: false },
];
