import {
  Bot,
  FileCode,
  FilePen,
  FilePlus,
  FolderTree,
  Globe,
  Image,
  ImagePlus,
  ListTodo,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TranscriptStep } from '@/features/sessions/types/TranscriptStep';

/**
 * A tool name is the provider's own vocabulary, so this stays a purely cosmetic lookup with a
 * neutral fallback — never a behavioural switch. A tool this map has never heard of,
 * from this adapter or any future one, still renders as a step; it just gets the generic icon.
 */
const icons: Record<string, LucideIcon> = {
  Read: FileCode,
  Write: FilePlus,
  Edit: FilePen,
  MultiEdit: FilePen,
  NotebookEdit: FilePen,
  Bash: Terminal,
  Glob: FolderTree,
  Grep: Search,
  WebSearch: Search,
  WebFetch: Globe,
  TodoWrite: ListTodo,
  Task: Bot,
  Agent: Bot,
  MessageAgent: Bot,
  ResumeAgent: Bot,
  WaitAgent: Bot,
  CloseAgent: Bot,
  InterruptAgent: Bot,
  ListAgents: Bot,
  Skill: Sparkles,
  ImageGeneration: ImagePlus,
  ViewImage: Image,
};

export const toolIcon = (name: string): LucideIcon => icons[name] ?? Wrench;

const editingTools = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export const toolFilePath = (step: TranscriptStep): string | null => {
  if (step.name !== 'Read' && !editingTools.has(step.name)) return null;
  const path = step.input[step.name === 'NotebookEdit' ? 'notebook_path' : 'file_path'];
  return typeof path === 'string' && path.trim() ? path : null;
};

export const toolCategory = (name: string, status: TranscriptStep['status']) => {
  if (name === 'Read') return status === 'failed' ? 'Read failed' : 'Read';
  if (editingTools.has(name)) {
    if (status === 'failed') return 'Edit failed';
    return status === 'done' ? 'Edited' : 'Editing';
  }
  if (name === 'Bash') return 'Run command';
  if (name === 'WebSearch') return 'Tool WebSearch';
  if (name === 'Skill') return 'Skill';
  if (name === 'ImageGeneration') return status === 'running' ? 'Generating image' : 'Image';
  if (name === 'ViewImage') return 'View image';
  if (name === 'WaitAgent') return 'Wait for agents';
  if (name === 'MessageAgent') return 'Message agent';
  if (name === 'ResumeAgent') return 'Resume agent';
  if (name === 'CloseAgent') return 'Close agent';
  if (name === 'InterruptAgent') return 'Interrupt agent';
  if (name === 'ListAgents') return 'List agents';
  return 'Tool';
};
