/** Exact command boundary: /compactly and mentions inside prose remain ordinary messages. */
export const compactInstructions = (text: string): string | null => {
  const match = /^\/compact(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? (match[1] ?? '').trim() : null;
};
