/** `running` spans have no `endMs` yet; `incomplete` ones stopped without a result (log cut, crash). */
export type TraceSpanStatus = 'running' | 'ok' | 'error' | 'interrupted' | 'incomplete';
