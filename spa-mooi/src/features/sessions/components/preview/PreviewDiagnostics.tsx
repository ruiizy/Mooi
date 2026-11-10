export const PreviewDiagnostics = ({ url }: { url: string }) => {
  const mixedContent = window.location.protocol === 'https:' && new URL(url).protocol === 'http:';
  return <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-line bg-surface px-3 py-2 text-xs text-ink-muted">
    {mixedContent ? <p role="status" className="mb-2">This HTTP preview cannot be embedded securely in HTTPS Mooi. Serve Mooi's sessions service over HTTPS.</p> : null}
    <details>
      <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-brand">Preview blank or not loading?</summary>
      <div className="space-y-2 py-2 [overflow-wrap:anywhere]">
        <p>The server verified that the application responded. Mooi serves it through its own preview proxy under a private path that changes on every deploy and stops working once the deployment stops.</p>
        <p>If the page stays blank, reload the preview. Assets or pages that fail usually mean the frontend ignores its base path: ask the agent to rebuild it from <code>MOOI_PREVIEW_BASE_PATH</code>.</p>
        <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="inline-block underline focus-visible:outline-2 focus-visible:outline-brand">Open application in a new tab</a>
      </div>
    </details>
  </div>;
};
