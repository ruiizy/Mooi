/** Calls grouped by tool; sub-agents and skills are named `Sub-agent: …` / `Skill: …`. Top 40 only. */
export interface TraceToolStat {
  name: string;
  kind: 'tool' | 'agent' | 'skill';
  calls: number;
  errors: number;
  durationMs: number;
}
