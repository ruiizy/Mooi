/** Claude delegates through `Agent` (formerly `Task`); the Codex adapter reports a spawn as `Agent`. */
export const isSubagentTool = (name: string): boolean => name === 'Agent' || name === 'Task';
