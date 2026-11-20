// Stands in until the real Editor lands: another agent is building it as screens/Editor.tsx with
// these same props ({ schemeId, onBack }); App.tsx then swaps this for it.

export function EditorPlaceholder({ schemeId, onBack }: { schemeId: string; onBack: () => void }) {
  return (
    <main className="screen">
      <button type="button" className="btn ghost" onClick={onBack}>
        Back to Library
      </button>
      <h1 className="screen-title">Editor</h1>
      <p className="hint">
        The editor isn&apos;t built yet. This is the scheme it will open: <code>{schemeId}</code>
      </p>
    </main>
  );
}
