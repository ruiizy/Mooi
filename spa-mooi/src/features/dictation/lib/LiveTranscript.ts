import { revealCaret } from '@/features/dictation/lib/revealCaret';
import { setNativeValue } from '@/features/dictation/lib/setNativeValue';
import type { DictationTarget } from '@/features/dictation/types/DictationTarget';

/**
 * Owns only the slice of the field it wrote: the text between the original selection bounds. Any
 * edit made by someone else makes the field diverge from what this slice expects, and from then on
 * it never writes again — the dictation can lose its text, the user can never lose theirs. Text
 * dictated right after a word gets a separating space, so consecutive dictations never glue.
 * Cursor movement alone does not release the slice: every transcript update reveals its end,
 * including repeated partials and a final result identical to the last partial.
 */
export class LiveTranscript {
  private readonly target: DictationTarget;
  private readonly separator: string;
  private rendered = '';
  private changed = false;

  constructor(target: DictationTarget) {
    this.target = target;
    const before = target.original[target.start - 1];
    this.separator = before !== undefined && !/\s/.test(before) ? ' ' : '';
  }

  /** The caret right after the owned slice. */
  get caret(): number {
    return this.target.start + this.rendered.length;
  }

  private get expected(): string {
    const { original, start, end } = this.target;
    if (!this.changed) return original;
    return original.slice(0, start) + this.rendered + original.slice(end);
  }

  private writable(): boolean {
    const { element } = this.target;
    return element.isConnected && !element.disabled && !element.readOnly && element.value === this.expected;
  }

  /** Replaces the owned slice with `text`; false when the field is no longer ours to write. */
  update(text: string): boolean {
    if (!this.writable()) return false;
    const slice = text ? this.separator + text : '';
    if (!this.changed && !slice) return true;
    const { element, original, start, end } = this.target;
    const available = element.maxLength < 0 ? Infinity : element.maxLength - (original.length - (end - start));
    if (slice.length > available) return false;
    if (slice !== this.rendered) {
      setNativeValue(element, original.slice(0, start) + slice + original.slice(end));
      this.rendered = slice;
      this.changed = true;
    }
    // Even unchanged text must bring dictation back into view after the user moves the cursor.
    element.setSelectionRange(this.caret, this.caret);
    revealCaret(element);
    return true;
  }

  /** Restores the original value and selection, only when the field still holds exactly our draft. */
  rollback(): void {
    if (!this.changed || !this.writable()) return;
    const { element, original, start, end } = this.target;
    setNativeValue(element, original);
    element.setSelectionRange(start, end);
    this.rendered = '';
    this.changed = false;
  }
}
