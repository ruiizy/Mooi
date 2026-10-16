export interface AgentCapabilities {
  streaming: boolean;
  thinking: boolean;
  permissions: boolean;
  questions: boolean;
  interrupt: boolean;
  editableToolInput: boolean;
  cost: boolean;
  /** Messages may carry images; each model may still decline them (see `SessionProvider`). */
  images?: boolean;
  /** Side questions (`/btw`) answered beside the conversation without entering it. */
  asides?: boolean;
}
