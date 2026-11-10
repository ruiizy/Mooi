import {
  Bot,
  CircleAlert,
  Layers,
  MessageSquare,
  Minimize2,
  Repeat,
  Sparkles,
  Webhook,
  Wrench,
  Zap,
} from 'lucide-react';

import type { TraceKindStyle } from '@/features/traces/types/TraceKindStyle';
import type { TraceSpanKind } from '@/features/traces/types/TraceSpanKind';
import type { TraceSpanStatus } from '@/features/traces/types/TraceSpanStatus';

const styles: Record<TraceSpanKind, TraceKindStyle> = {
  prompt: { icon: MessageSquare, label: 'Prompt', text: 'text-ink', chip: 'bg-surface-2 text-ink', bar: 'bg-ink-muted' },
  turn: { icon: Repeat, label: 'Turn', text: 'text-ink-muted', chip: 'bg-surface-2 text-ink-muted', bar: 'bg-line-strong' },
  llm: { icon: Sparkles, label: 'LLM call', text: 'text-info', chip: 'bg-info-soft text-info', bar: 'bg-info-dot' },
  tool: { icon: Wrench, label: 'Tool', text: 'text-success', chip: 'bg-success-soft text-success', bar: 'bg-success-dot' },
  agent: { icon: Bot, label: 'Sub-agent', text: 'text-accent', chip: 'bg-accent-soft text-accent', bar: 'bg-accent-dot' },
  skill: { icon: Zap, label: 'Skill', text: 'text-warning', chip: 'bg-warning-soft text-warning', bar: 'bg-warning-dot' },
  hook: { icon: Webhook, label: 'Hook', text: 'text-ink-subtle', chip: 'bg-surface-2 text-ink-subtle', bar: 'bg-line-strong' },
  context: { icon: Layers, label: 'Context', text: 'text-info/70', chip: 'bg-info-soft/60 text-info/80', bar: 'bg-info-dot/50' },
  compaction: {
    icon: Minimize2,
    label: 'Compaction',
    text: 'text-warning',
    chip: 'bg-warning-soft text-warning',
    bar: 'bg-warning-dot',
  },
  event: { icon: CircleAlert, label: 'Event', text: 'text-ink-subtle', chip: 'bg-surface-2 text-ink-subtle', bar: 'bg-line-strong' },
};

const errorEvent: TraceKindStyle = {
  ...styles.event,
  text: 'text-danger',
  chip: 'bg-danger-soft text-danger',
  bar: 'bg-danger-dot',
};

/** Icon, label and token classes of a span kind; an event in error turns danger. */
export const traceKindStyle = (kind: TraceSpanKind, status?: TraceSpanStatus): TraceKindStyle =>
  kind === 'event' && status === 'error' ? errorEvent : styles[kind];
