export type DictationServerMessage =
  | { type: 'ready'; maxSeconds: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string };
