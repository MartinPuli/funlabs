/** Unified diff with added/removed lines marked by color and by +/- text. */
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre className="code-block" style={{ marginTop: 8, maxHeight: 480 }} aria-label="Differences between the baseline version and the variant">
      {lines.map((line, i) => (
        <span key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-del' : line.startsWith('@@') ? 'muted' : undefined} style={{ display: 'block' }}>
          {line || ' '}
        </span>
      ))}
    </pre>
  );
}
