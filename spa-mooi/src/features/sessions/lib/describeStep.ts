import {
  Bot,
  Brain,
  FileCode,
  FilePen,
  FilePlus,
  FolderTree,
  Globe,
  Image,
  ImagePlus,
  ListTodo,
  Plug,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { describeCommand } from '@/features/sessions/lib/describeCommand';
import type { CommandKind, CommandStep } from '@/features/sessions/lib/describeCommand';
import type { TranscriptStep } from '@/features/sessions/types/TranscriptStep';

/** What a step did, grouped the way an activity summary counts it ("Explored 3 files, ran 2 commands"). */
export type StepKind = CommandKind | 'edit' | 'web' | 'agent' | 'plan' | 'image' | 'tool';

export interface StepDescription {
  kind: StepKind;
  icon: LucideIcon;
  /** Verb phrase for the step's current status: "Reading" while running, "Read" once done. */
  verb: string;
  /** The verb alone does not say the step failed ("Ran tests"), so the row has to. */
  failureTag: boolean;
  detail: string | null;
  /** The file a read/edit touched, so a summary counts files rather than calls. */
  target: string | null;
  /** The shell command as the user should read it, for command steps. */
  command: string | null;
  /** The named parts of a command line that chains several commands. */
  steps: CommandStep[];
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/**
 * The main agent managing agents it delegated to (Codex collab calls other than a spawn, which
 * becomes the delegation card itself): coordination steps, not new delegations.
 */
const AGENT_COORDINATION = new Map<string, { active: string; done: string }>([
  ['WaitAgent', { active: 'Waiting for agents', done: 'Waited for agents' }],
  ['MessageAgent', { active: 'Messaging agent', done: 'Messaged agent' }],
  ['ResumeAgent', { active: 'Resuming agent', done: 'Resumed agent' }],
  ['CloseAgent', { active: 'Closing agent', done: 'Closed agent' }],
  ['InterruptAgent', { active: 'Interrupting agent', done: 'Interrupted agent' }],
  ['ListAgents', { active: 'Listing agents', done: 'Listed agents' }],
]);

const KIND_ICONS: Record<StepKind, LucideIcon> = {
  read: FileCode,
  search: Search,
  list: FolderTree,
  command: Terminal,
  edit: FilePen,
  web: Globe,
  agent: Bot,
  plan: ListTodo,
  image: Image,
  tool: Wrench,
};

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

const basename = (path: string): string => path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

interface Phrase {
  kind: StepKind;
  active: string;
  done: string;
  failed?: string;
  detail?: string | null;
  target?: string | null;
  command?: string | null;
  steps?: CommandStep[];
  icon?: LucideIcon;
}

/** Codex reports what a command does (`commandActions`); trust it over parsing the command line. */
const codexAction = (input: Record<string, unknown>, display: string): Phrase | null => {
  const actions = Array.isArray(input.commandActions) ? input.commandActions as Record<string, unknown>[] : [];
  if (!actions.length || actions.some((action) => !action || action.type === 'unknown')) return null;
  const [first] = actions;
  const files = actions.map((action) => text(action.name) ?? (text(action.path) ? basename(String(action.path)) : null)).filter(Boolean);
  if (actions.every((action) => action.type === 'read')) {
    return { kind: 'read', active: 'Reading', done: 'Read', detail: files.join(', ') || null,
      target: text(first.path) ?? text(first.name), command: display };
  }
  if (first.type === 'search') {
    const where = text(first.path) ? ` in ${String(first.path)}` : '';
    return { kind: 'search', active: 'Searching for', done: 'Searched for', detail: text(first.query) ? `${first.query}${where}` : text(first.path),
      command: display };
  }
  if (first.type === 'listFiles') {
    return { kind: 'list', active: 'Listing', done: 'Listed', detail: text(first.path) ?? '.', command: display };
  }
  return null;
};

const phraseFor = (step: TranscriptStep): Phrase => {
  const { name, input } = step;

  if (name === 'Bash') {
    const command = describeCommand(input.command);
    return codexAction(input, command.display) ?? { ...command, command: command.display };
  }
  if (name === 'BashOutput' || name === 'KillShell' || name === 'KillBash') {
    return name === 'BashOutput'
      ? { kind: 'command', active: 'Reading command output', done: 'Read command output', icon: Terminal }
      : { kind: 'command', active: 'Stopping command', done: 'Stopped command', icon: Terminal };
  }
  if (name === 'Read') {
    const path = text(input.file_path);
    return { kind: 'read', active: 'Reading', done: 'Read', failed: 'Could not read', detail: path ? basename(path) : null, target: path };
  }
  if (EDIT_TOOLS.has(name)) {
    const path = text(input[name === 'NotebookEdit' ? 'notebook_path' : 'file_path']) ?? text(input.path);
    if (input.operation === 'delete') {
      return { kind: 'edit', active: 'Deleting', done: 'Deleted', failed: 'Could not delete', detail: path ? basename(path) : null, target: path };
    }
    const creating = name === 'Write';
    return { kind: 'edit', active: creating ? 'Writing' : 'Editing', done: creating ? 'Wrote' : 'Edited', failed: 'Could not edit',
      detail: path ? basename(path) : step.title !== name ? step.title : null, target: path ?? step.title,
      icon: creating ? FilePlus : FilePen };
  }
  if (name === 'Grep') {
    const where = text(input.path) ?? text(input.glob);
    return { kind: 'search', active: 'Searching for', done: 'Searched for',
      detail: text(input.pattern) ? `${input.pattern}${where ? ` in ${where}` : ''}` : null };
  }
  if (name === 'Glob') {
    return { kind: 'search', active: 'Finding files', done: 'Found files',
      detail: text(input.pattern) ? `${input.pattern}${text(input.path) ? ` in ${input.path}` : ''}` : null, icon: FolderTree };
  }
  if (name === 'LS') return { kind: 'list', active: 'Listing', done: 'Listed', detail: text(input.path) ?? '.' };
  if (name === 'WebSearch') {
    return { kind: 'web', active: 'Searching the web for', done: 'Searched the web for', icon: Search,
      detail: text(input.query) ?? text((input.action as Record<string, unknown> | undefined)?.query) ?? (step.title !== name ? step.title : null) };
  }
  if (name === 'WebFetch') {
    const url = text(input.url);
    return { kind: 'web', active: 'Reading', done: 'Read', detail: url ? hostOf(url) : null };
  }
  if (name === 'TodoWrite' || name === 'todoList' || name === 'plan') {
    const todos = Array.isArray(input.todos) ? input.todos as Record<string, unknown>[] : [];
    const current = todos.find((todo) => todo.status === 'in_progress');
    return { kind: 'plan', active: 'Updating plan', done: 'Updated plan',
      detail: text(current?.activeForm) ?? text(current?.content) ?? (todos.length ? `${todos.length} tasks` : null) };
  }
  if (name === 'Task' || name === 'Agent' || name === 'collabToolCall') {
    return { kind: 'agent', active: 'Delegating', done: 'Delegated', detail: text(input.description) ?? text(input.prompt) };
  }
  const coordination = AGENT_COORDINATION.get(name);
  if (coordination) {
    return { kind: 'tool', active: coordination.active, done: coordination.done, icon: Bot,
      detail: text(input.prompt) ?? (step.title !== name ? step.title : null) };
  }
  if (name === 'Skill') {
    return { kind: 'tool', active: 'Using skill', done: 'Used skill', detail: text(input.skill) ?? text(input.name) ?? step.title, icon: Sparkles };
  }
  if (name === 'ImageGeneration') return { kind: 'image', active: 'Generating image', done: 'Generated image', icon: ImagePlus, detail: text(input.prompt) };
  if (name === 'ViewImage') {
    const path = text(input.path);
    return { kind: 'image', active: 'Viewing', done: 'Viewed', detail: path ? basename(path) : 'image' };
  }
  if (name === 'ExitPlanMode') return { kind: 'plan', active: 'Presenting plan', done: 'Presented plan' };
  // MCP tools: Claude names them `mcp__server__tool`, Codex reports an `mcpToolCall` item.
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp || name === 'mcpToolCall') {
    const server = mcp ? mcp[1] : text(input.server) ?? 'MCP';
    const tool = mcp ? mcp[2] : text(input.tool) ?? 'tool';
    return { kind: 'tool', active: 'Calling', done: 'Called', detail: `${server} · ${tool.replace(/_/g, ' ')}`, icon: Plug };
  }
  return { kind: 'tool', active: `Using ${name}`, done: `Used ${name}`, detail: step.title !== name ? step.title : null };
};

/**
 * Turns a step into the line the activity log shows. A tool name is the provider's own vocabulary,
 * so this stays a cosmetic lookup with a neutral fallback — never a behavioural switch: a tool this
 * has never heard of, from this adapter or a future one, still reads as "Used <tool>".
 */
export const describeStep = (step: TranscriptStep): StepDescription => {
  const phrase = phraseFor(step);
  const verb = step.status === 'running' ? phrase.active : step.status === 'failed' ? phrase.failed ?? phrase.done : phrase.done;
  return {
    kind: phrase.kind,
    icon: phrase.icon ?? KIND_ICONS[phrase.kind],
    verb,
    failureTag: step.status === 'failed' && !phrase.failed,
    detail: phrase.detail ?? null,
    target: phrase.target ?? null,
    command: phrase.command ?? null,
    steps: phrase.steps ?? [],
  };
};

export const thinkingIcon: LucideIcon = Brain;

/** Codex reasoning summaries open with a bold headline (`**Planning the refactor**`): use it as the label. */
export const thinkingHeadline = (text: string): string | null => {
  const match = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)/.exec(text) ?? /^\s*#{1,6}\s+(.+)$/m.exec(text);
  const headline = match?.[1]?.trim();
  return headline && headline.length <= 80 ? headline : null;
};
