/**
 * What a span stands for: a user prompt, a turn (one agent-loop iteration: a model call and the tools it
 * requested), one model request, a tool call, a sub-agent, a skill, a hook...
 */
export type TraceSpanKind = 'prompt' | 'turn' | 'llm' | 'tool' | 'agent' | 'skill' | 'hook' | 'context' | 'compaction' | 'event';
