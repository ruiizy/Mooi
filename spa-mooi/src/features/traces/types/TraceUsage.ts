/**
 * Tokens of one model request. `input` is the non-cached part of the prompt; `context` is the whole
 * prompt (input + cache read + cache write), i.e. the context size of that request.
 */
export interface TraceUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  context: number;
}
