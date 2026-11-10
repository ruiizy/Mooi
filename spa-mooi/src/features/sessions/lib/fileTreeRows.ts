import type { FileTreeRow } from '@/features/sessions/types/FileTreeRow';

interface DirectoryNode {
  directories: Map<string, DirectoryNode>;
  files: string[];
}

const emptyDirectory = (): DirectoryNode => ({ directories: new Map(), files: [] });

const byName = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });

/** Nests sorted-or-not flat paths into a folder tree. */
const buildTree = (paths: string[]): DirectoryNode => {
  const root = emptyDirectory();
  for (const path of paths) {
    const segments = path.split('/');
    const name = segments.pop() ?? path;
    let node = root;
    for (const segment of segments) {
      let child = node.directories.get(segment);
      if (!child) {
        child = emptyDirectory();
        node.directories.set(segment, child);
      }
      node = child;
    }
    node.files.push(name);
  }
  return root;
};

/** Every folder that holds `path`, outermost first; the merged-chain keys the tree rows use. */
export const ancestorDirectories = (path: string): string[] => {
  const segments = path.split('/').slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
};

/**
 * Flattens the folder tree into the rows that are visible given the open folders, folders first.
 * A folder whose only content is another folder is merged into one `a/b/c` row, like a project view
 * does, so deep structures stay shallow. A folder is open when `isOpen` says so for its deepest path.
 */
export const fileTreeRows = (paths: string[], isOpen: (directory: string) => boolean): FileTreeRow[] => {
  const rows: FileTreeRow[] = [];

  const walk = (node: DirectoryNode, prefix: string, depth: number) => {
    for (const name of [...node.directories.keys()].sort(byName)) {
      let child = node.directories.get(name) as DirectoryNode;
      let label = name;
      let path = prefix ? `${prefix}/${name}` : name;
      while (child.files.length === 0 && child.directories.size === 1) {
        const [[next, nested]] = [...child.directories];
        label = `${label}/${next}`;
        path = `${path}/${next}`;
        child = nested;
      }
      const expanded = isOpen(path);
      rows.push({ kind: 'directory', path, name: label, depth, expanded });
      if (expanded) walk(child, path, depth + 1);
    }
    for (const name of [...node.files].sort(byName)) {
      rows.push({ kind: 'file', path: prefix ? `${prefix}/${name}` : name, name, depth, expanded: false });
    }
  };

  walk(buildTree(paths), '', 0);
  return rows;
};
