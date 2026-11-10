const KEY = 'mooi.todos.expanded';

/**
 * Remembers on this device which projects the player keeps expanded on the To-dos page. Storage may
 * be unavailable (private mode), in which case every project simply starts collapsed.
 */
export const expandedTodoProjects = {
  read: (): string[] => {
    try {
      const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  },
  write: (projectIds: string[]): void => {
    try { window.localStorage.setItem(KEY, JSON.stringify(projectIds)); } catch { /* a convenience, never state */ }
  },
};
