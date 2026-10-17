import { applySubagentUpdate } from './applySubagentUpdate';
import { isSubagentTool } from './isSubagentTool';
import { newSubagent } from './newSubagent';
import { resolveStepIn } from './resolveStepIn';
import { settleTurnBlocks } from './settleTurnBlocks';
import { updateSubagentIn } from './updateSubagentIn';
import { withBlockText } from './withBlockText';
import { DEPLOYMENT_LOG_LIMIT } from './deploymentLogLimit';
import type { SessionPendingRequest } from '@/features/sessions/types/SessionPendingRequest';
import type { AgentQuestion } from '@/features/sessions/types/AgentQuestion';
import type { ChangesSummary } from '@/features/sessions/types/ChangesSummary';
import type { ImageAttachment } from '@/features/sessions/types/ImageAttachment';
import type { SessionEvent } from '@/features/sessions/types/SessionEvent';
import type { SessionTranscriptState } from '@/features/sessions/types/SessionTranscriptState';
import type { TranscriptBlock } from '@/features/sessions/types/TranscriptBlock';
import type { TranscriptEntry } from '@/features/sessions/types/TranscriptEntry';
import type { TranscriptStep } from '@/features/sessions/types/TranscriptStep';
import type { TranscriptSubagent } from '@/features/sessions/types/TranscriptSubagent';

/**
 * A fresh transcript always starts at `seq` 0 — even for a session that already has history —
 * because the client has replayed nothing yet: `useSessionStream` opens with `after: 0`, and the
 * server's replay reconstructs every entry from scratch. Only a stream that drops and
 * reconnects mid-mount resumes from a later `seq`, and that resume lives inside
 * `openSessionStream` itself, not here.
 */
export const emptyTranscriptState = (): SessionTranscriptState => ({
  pane: 'conversation',
  previewOpenedOperationId: null,
  deploymentLog: [],
  deploymentLogOpen: false,
  entries: [],
  pending: [],
  changes: null,
  changesStatus: 'idle',
  changesError: null,
  changesEventSeq: 0,
  lastMerge: null,
  lastSeq: 0,
  streamState: 'closed',
});

type AssistantEntry = Extract<TranscriptEntry, { kind: 'assistant' }>;

const isOpenAssistantEntry = (entry: TranscriptEntry | undefined): entry is AssistantEntry =>
  entry !== undefined && entry.kind === 'assistant' && entry.streaming;

const newTurnEntry = (seq: number, at: string, blocks: TranscriptBlock[]): AssistantEntry => ({
  id: `turn-${seq}`,
  kind: 'assistant',
  at,
  streaming: true,
  blocks,
  result: null,
});

/** Closes the currently open turn, if any — a no-op when the last entry is not an open assistant one. */
const closeOpenEntry = (entries: TranscriptEntry[], patch: Partial<AssistantEntry> = {}): TranscriptEntry[] => {
  const last = entries[entries.length - 1];

  if (!isOpenAssistantEntry(last)) {
    return entries;
  }

  return [...entries.slice(0, -1), { ...last, streaming: false, blocks: settleTurnBlocks(last.blocks), ...patch }];
};

/** Applies `update` to the open turn's blocks, starting a new turn when none is open and the result is not empty. */
const withOpenTurn = (
  entries: TranscriptEntry[],
  seq: number,
  at: string,
  update: (blocks: TranscriptBlock[]) => TranscriptBlock[],
): TranscriptEntry[] => {
  const last = entries[entries.length - 1];

  if (isOpenAssistantEntry(last)) {
    return [...entries.slice(0, -1), { ...last, blocks: update(last.blocks) }];
  }

  const blocks = update([]);
  return blocks.length ? [...entries, newTurnEntry(seq, at, blocks)] : entries;
};

/**
 * Applies `update` to the delegation with `toolUseId` in any turn — a detached agent keeps
 * reporting after its turn closed. Null when the delegation is unknown (e.g. trimmed history).
 */
const withSubagent = (
  entries: TranscriptEntry[],
  toolUseId: string,
  update: (subagent: TranscriptSubagent) => TranscriptSubagent,
): TranscriptEntry[] | null => {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== 'assistant') continue;
    const blocks = updateSubagentIn(entry.blocks, toolUseId, update);
    if (blocks) return entries.map((item, index) => (index === i ? { ...entry, blocks } : item));
  }
  return null;
};

/**
 * Routes a block change into the delegation that produced it (`parentToolUseId`), so a subagent's
 * work never mixes with the main agent's; without a known parent it lands on the open turn.
 */
const withBlocks = (
  entries: TranscriptEntry[],
  seq: number,
  at: string,
  parent: string | null,
  update: (blocks: TranscriptBlock[]) => TranscriptBlock[],
): TranscriptEntry[] => (parent ? withSubagent(entries, parent, (subagent) => ({ ...subagent,
  status: subagent.status === 'started' ? 'working' : subagent.status, blocks: update(subagent.blocks) })) : null)
  ?? withOpenTurn(entries, seq, at, update);

/** Text the platform adds to the open turn (requests, answers, provider notices). */
const withRequestText = (entries: TranscriptEntry[], seq: number, at: string, id: string, text: string, mode: 'append' | 'replace') =>
  withOpenTurn(entries, seq, at, (blocks) => withBlockText(blocks, 'text', id, text, mode));

/** A tool call: a delegation to another agent, or an ordinary step. Never added twice. */
const withToolBlock = (blocks: TranscriptBlock[], step: TranscriptStep): TranscriptBlock[] => {
  const exists = blocks.some((block) => (block.kind === 'step' && block.step.toolUseId === step.toolUseId)
    || (block.kind === 'subagent' && block.subagent.toolUseId === step.toolUseId));
  if (exists) return blocks;
  return [...blocks, isSubagentTool(step.name)
    ? { kind: 'subagent', subagent: newSubagent(step.toolUseId, step.title, step.input) }
    : { kind: 'step', step }];
};

/** Finds the step by `toolUseId` — searching every turn and delegation, not just the open turn,
 * since a slow tool can still be resolving after its turn has otherwise moved on. */
const withResolvedStep = (
  entries: TranscriptEntry[],
  toolUseId: string,
  isError: boolean,
  summary: string,
  images: ImageAttachment[],
): TranscriptEntry[] => {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== 'assistant') continue;
    const blocks = resolveStepIn(entry.blocks, toolUseId, { isError, summary, images });
    if (blocks) return entries.map((item, index) => (index === i ? { ...entry, blocks } : item));
  }

  return entries;
};

/**
 * The pure fold turning one SSE event into the next transcript state. Mirrors `record()` in
 * `mic-sessions/features/sessions.py` for the parts the SPA also has to derive — `waiting` on a
 * request, closing the open turn on its resolution or on `turn.result` — so server and client can
 * never disagree. Safe to replay: folding the same ordered events from empty state
 * always produces the same result.
 *
 * An `assistant` entry spans a whole turn, not a single SDK message: the Claude Agent SDK can emit
 * several internal `AssistantMessage`s before `turn.result` (text, then a tool call, then more
 * text), and their blocks all append, in order, to the same entry — whichever one is last in
 * `entries` while still `streaming`. Only one turn can run at a time in a session.
 */
export const applySessionEvent = (state: SessionTranscriptState, event: SessionEvent): SessionTranscriptState => {
  const { seq, at, type, data } = event;
  if (type === 'history.reset') {
    return { ...emptyTranscriptState(), pane: state.pane, previewOpenedOperationId: state.previewOpenedOperationId,
      deploymentLog: state.deploymentLog, deploymentLogOpen: state.deploymentLogOpen, streamState: state.streamState, lastSeq: seq,
      entries: [{ id: `gap-${seq}`, kind: 'error', at, text: String(data.message) }] };
  }
  if (type === 'session.sync') {
    if (seq < state.lastSeq) return state;
    const status = (data.session as { status?: string } | undefined)?.status;
    return { ...state, lastSeq: seq, pending: data.pending as SessionPendingRequest[],
      entries: status && status !== 'working' && status !== 'waiting'
        ? closeOpenEntry(state.entries) : state.entries };
  }
  if (seq <= state.lastSeq) return state;
  if (event.type === 'deployment.log') {
    const log = event.data;
    const current = state.deploymentLog[0]?.operationId === log.operationId ? state.deploymentLog : [];
    return { ...state, lastSeq: seq, deploymentLog: current.some((batch) => batch.index === log.index) ? current
      : [...current, log].sort((a, b) => a.index - b.index).slice(-DEPLOYMENT_LOG_LIMIT) };
  }
  let entries = state.entries;
  let pending = state.pending;
  let changes = state.changes;
  let changesStatus = state.changesStatus;
  let changesError = state.changesError;
  let changesEventSeq = state.changesEventSeq;
  let lastMerge = state.lastMerge;
  // Set on work done inside a delegated agent; deployment events never carry it.
  const parentToolUseId = (data as Record<string, unknown>).parentToolUseId;
  const parent = typeof parentToolUseId === 'string' && parentToolUseId ? parentToolUseId : null;

  switch (type) {
    case 'message.user': {
      entries = closeOpenEntry(entries);
      entries = [...entries, { id: String(data.messageId), kind: 'user', at, text: String(data.text ?? ''),
        images: Array.isArray(data.images) ? data.images as ImageAttachment[] : [] }];
      break;
    }
    case 'assistant.delta': {
      entries = withBlocks(entries, seq, at, parent, (blocks) =>
        withBlockText(blocks, 'text', String(data.messageId), String(data.text ?? ''), 'append'));
      break;
    }
    case 'assistant.message': {
      entries = withBlocks(entries, seq, at, parent, (blocks) =>
        withBlockText(blocks, 'text', String(data.messageId), String(data.text ?? ''), 'replace'));
      break;
    }
    case 'thinking.delta': {
      entries = withBlocks(entries, seq, at, parent, (blocks) =>
        withBlockText(blocks, 'thinking', String(data.messageId), String(data.text ?? ''), 'append'));
      break;
    }
    case 'thinking.message': {
      entries = withBlocks(entries, seq, at, parent, (blocks) =>
        withBlockText(blocks, 'thinking', String(data.messageId), String(data.text ?? ''), 'replace'));
      break;
    }
    case 'tool.use': {
      entries = withBlocks(entries, seq, at, parent, (blocks) => withToolBlock(blocks, {
        toolUseId: String(data.toolUseId),
        name: String(data.name),
        title: String(data.title ?? data.name),
        input: (data.input as Record<string, unknown> | undefined) ?? {},
        status: 'running',
        summary: null,
        images: [],
      }));
      break;
    }
    case 'subagent.updated': {
      entries = withSubagent(entries, String(data.toolUseId), (subagent) => applySubagentUpdate(subagent, data)) ?? entries;
      break;
    }
    case 'tool.result': {
      entries = withResolvedStep(
        entries,
        String(data.toolUseId),
        Boolean(data.isError),
        String(data.summary ?? ''),
        Array.isArray(data.images) ? data.images as ImageAttachment[] : [],
      );
      changesStatus = 'loading';
      changesError = null;
      break;
    }
    case 'permission.request': {
      entries = withRequestText(entries, seq, at, `request-${data.requestId}`,
        `Approval requested: ${String(data.title ?? data.toolName)}`, 'replace');
      pending = [...pending.filter((request) => request.requestId !== String(data.requestId)), {
        kind: 'permission',
        requestId: String(data.requestId),
        toolName: String(data.toolName),
        title: String(data.title ?? data.toolName),
        input: (data.input as Record<string, unknown> | undefined) ?? {},
      }];
      break;
    }
    case 'question.request': {
      entries = withRequestText(entries, seq, at, `request-${data.requestId}`,
        ((data.questions as AgentQuestion[]) ?? []).map((question) => question.question).join('\n'), 'replace');
      pending = [...pending.filter((request) => request.requestId !== String(data.requestId)), {
        kind: 'question',
        requestId: String(data.requestId),
        questions: (data.questions as AgentQuestion[] | undefined) ?? [],
      }];
      break;
    }
    case 'permission.resolved':
    case 'question.resolved': {
      entries = withRequestText(entries, seq, at, `answer-${data.requestId}`,
        data.answers ? Object.entries(data.answers as Record<string, string | string[]>).map(([question, answer]) => `**${question}**\n\n${Array.isArray(answer) ? answer.join(', ') : answer}`).join('\n\n') : `Decision: ${String(data.decision ?? 'resolved')}`, 'replace');
      pending = pending.filter((request) => request.requestId !== String(data.requestId));
      break;
    }
    case 'turn.result': {
      if (!isOpenAssistantEntry(entries[entries.length - 1])) {
        entries = [...entries, newTurnEntry(seq, at, [])];
      }
      entries = closeOpenEntry(entries, {
        result: {
          terminalReason: (data.terminalReason as string | null | undefined) ?? null,
          subtype: (data.subtype as string | null | undefined) ?? null,
          durationMs: (data.durationMs as number | null | undefined) ?? null,
          costUsd: (data.costUsd as number | null | undefined) ?? null,
          usage: (data.usage as Record<string, unknown> | null | undefined) ?? null,
        },
      });
      pending = [];
      changesStatus = 'loading';
      changesError = null;
      break;
    }
    case 'session.status': {
      const status = data.status as string | undefined;

      if (status === 'failed' || status === 'closed') pending = [];
      if (status !== 'working' && status !== 'waiting') {
        entries = closeOpenEntry(entries);
      }

      break;
    }
    case 'changes.updated': {
      const payload = data as unknown as ChangesSummary;
      changesEventSeq = seq;
      if (payload.status === 'error') {
        changesStatus = 'error';
        changesError = payload.error ?? 'Could not calculate changes.';
      } else {
        changes = payload;
        changesStatus = 'ready';
        changesError = null;
      }
      break;
    }
    case 'session.cleared': {
      entries = [{ id: `cleared-${seq}`, kind: 'notice', at, tone: 'info', title: 'Conversation cleared',
        text: 'The agent starts a fresh conversation for the next task.' }];
      pending = [];
      break;
    }
    case 'session.compaction': {
      const phase = String(data.phase);
      const previous = phase === 'started' ? entries : entries.map((entry) =>
        entry.kind === 'notice' && entry.tone === 'progress' ? { ...entry, tone: 'info' as const } : entry);
      entries = [...closeOpenEntry(previous), { id: `compaction-${seq}`, kind: 'notice', at,
        tone: phase === 'started' ? 'progress' : phase === 'completed' ? 'success' : 'info',
        title: phase === 'started' ? 'Compacting context…' : phase === 'completed' ? 'Context compacted' : 'Compaction failed',
        text: phase === 'started' ? 'Earlier messages stay visible while the agent condenses its context.'
          : phase === 'completed' ? 'The agent now continues with a concise summary of earlier messages.'
            : 'The earlier context is still available to the agent.' }];
      break;
    }
    case 'merge.completed': {
      lastMerge = { targetBranch: String(data.targetBranch), commit: String(data.commit), seq };
      entries = [...closeOpenEntry(entries), { id: `merge-${seq}`, kind: 'notice', at, tone: 'success',
        title: `Merged into ${String(data.targetBranch)} · ${String(data.commit).slice(0, 7)}`, text: String(data.message ?? '') || null }];
      break;
    }
    case 'agent.activity': {
      if (data.kind === 'conversation_reset') {
        entries = withRequestText(entries, seq, at, `activity-${seq}`,
          String(data.description ?? data.summary ?? ''), 'replace');
      }
      break;
    }
    case 'error': {
      entries = [
        ...closeOpenEntry(entries),
        { id: `error-${seq}`, kind: 'error', at, text: String(data.message ?? 'Something went wrong') },
      ];
      break;
    }
    default:
      break;
  }

  return {
    ...state,
    entries,
    pending,
    changes,
    changesStatus,
    changesError,
    changesEventSeq,
    lastMerge,
    lastSeq: seq,
  };
};
