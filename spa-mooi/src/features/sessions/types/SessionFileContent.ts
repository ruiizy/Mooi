import type { DiffPreview } from '@/features/sessions/types/DiffPreview';

export interface SessionFileContent {
  path: string;
  /** `text` files are editable; binary and oversized ones have no content to show. */
  preview: DiffPreview;
  content: string;
  /** Identifies the content that was read; a save names it so a concurrent edit is never overwritten. */
  revision: string;
  size: number;
}
