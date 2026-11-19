/** Why writing to the units is blocked right now. One line under the header. */
export function WriteBlockLine({ sentence }: { sentence: string }) {
  return (
    <p className="notice tone-warning" role="status">
      <span className="dot tone-warning" aria-hidden="true" />
      {sentence}
    </p>
  );
}
