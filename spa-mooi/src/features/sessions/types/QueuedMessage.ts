import type { ImageAttachment } from '@/features/sessions/types/ImageAttachment';

/** A message waiting for the agent's turn to end; the server delivers the queue in order, one per turn. */
export interface QueuedMessage {
  id: string;
  text: string;
  images: ImageAttachment[];
  createdAt: string;
}
