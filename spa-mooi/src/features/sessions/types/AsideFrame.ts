/** One NDJSON line of a side question's streamed answer. */
export type AsideFrame =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
