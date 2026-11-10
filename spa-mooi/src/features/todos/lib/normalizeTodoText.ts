/** One line with collapsed whitespace: what a Markdown task item can hold, exactly as the server stores it. */
export const normalizeTodoText = (value: string): string => value.trim().replace(/\s+/g, ' ');
