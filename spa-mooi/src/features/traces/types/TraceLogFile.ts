/** A downloaded raw agent log: one `.jsonl` file, or a `.zip` of every log the trace was built from. */
export interface TraceLogFile {
  blob: Blob;
  filename: string;
}
