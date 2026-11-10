const key = (projectId: string): string => `mooi.todos.kept.${projectId}`;

/**
 * Remembers on this device that the player chose to keep a file Mooi cannot render, for that exact
 * revision: once the file changes, the choice is asked again. Storage may be unavailable (private
 * mode), in which case the question simply comes back.
 */
export const keptTodosRevision = {
  read: (projectId: string): string | null => {
    try { return window.localStorage.getItem(key(projectId)); } catch { return null; }
  },
  write: (projectId: string, revision: string | null): void => {
    try {
      if (revision) window.localStorage.setItem(key(projectId), revision);
      else window.localStorage.removeItem(key(projectId));
    } catch { /* the choice is a convenience, never state */ }
  },
};
