/**
 * What the player has entered for a pending question or approval but not sent yet. Kept outside
 * the card so switching between the chat and a subagent's panel, or closing either, loses nothing.
 */
export interface RequestDraft {
  /** Question: picked option labels by question text. */
  selected?: Record<string, string[]>;
  /** Question: free text typed under "Other", by question text. */
  other?: Record<string, string>;
  /** Approval: the edited tool input, as JSON text. */
  input?: string;
  /** Approval: the reason for denying. */
  reason?: string;
}
