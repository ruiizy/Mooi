/** The agent and first message that open a platform chat. */
export interface PlatformChatRequest {
  provider: string;
  adapter?: string;
  connectionId: string;
  model: string;
  effort: string | null;
  message: string;
}
