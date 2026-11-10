export interface SessionFiles {
  /** Every visible file of the working tree, as sorted workspace-relative paths. */
  paths: string[];
  /** The workspace holds more files than the listing carries. */
  truncated: boolean;
}
