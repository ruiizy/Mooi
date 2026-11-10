/** One implementation of a provider, e.g. Claude through its SDK or through its CLI. */
export interface AgentAdapter {
  id: string;
  label: string;
}
