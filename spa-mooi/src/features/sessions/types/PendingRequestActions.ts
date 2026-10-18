/** How the player answers pending questions and approvals, wherever they are shown. */
export interface PendingRequestActions {
  busy: boolean;
  editableToolInput: boolean;
  onAllowPermission: (requestId: string, updatedInput?: Record<string, unknown>) => void;
  onDenyPermission: (requestId: string, message?: string) => void;
  onAnswerQuestion: (requestId: string, answers: Record<string, string | string[]>) => void;
}
