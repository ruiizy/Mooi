/**
 * A span's input or output as it is best read: JSON (an object or an array) is re-indented with two
 * spaces, anything else (plain text, a JSON cut by the backend's size cap) is returned unchanged.
 */
export const prettyTraceText = (text: string): string => {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
};
