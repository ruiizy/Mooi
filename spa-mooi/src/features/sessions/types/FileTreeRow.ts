export interface FileTreeRow {
  kind: 'directory' | 'file';
  /** Full workspace path; for a directory, that of its deepest folder when single-child chains are merged. */
  path: string;
  /** What the row shows: the last segment, or `a/b/c` for a merged chain. */
  name: string;
  depth: number;
  expanded: boolean;
}
