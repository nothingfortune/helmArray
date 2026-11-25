import { Fragment } from 'react';
import type { Preset } from '../../shared/api';
import type { PresetChoice } from './libraryView';

/**
 * The presets a new scheme can start from, one button each, wherever one is started. One the game
 * can't use is shown off (`aria-disabled`, so it is still found and read), with why in one sentence
 * beside it, tied to it as its description. `primary`: the first one on is the screen's primary
 * button. `idPrefix` keeps each sentence's id unique on the page.
 */
export function PresetButtons({
  choices,
  onChoose,
  idPrefix,
  primary = false,
  busy = false,
}: {
  choices: readonly PresetChoice[];
  onChoose(preset: Preset): void;
  idPrefix: string;
  primary?: boolean;
  busy?: boolean;
}) {
  const first = choices.findIndex((c) => c.unavailable === undefined);
  return (
    <>
      {choices.map((choice, i) => {
        if (choice.unavailable === undefined)
          return (
            <button
              key={choice.preset}
              type="button"
              className={primary && i === first ? 'btn primary' : 'btn'}
              disabled={busy}
              onClick={() => onChoose(choice.preset)}
            >
              {choice.label}
            </button>
          );
        const why = `${idPrefix}-${choice.preset}-why`;
        return (
          <Fragment key={choice.preset}>
            <button type="button" className="btn" aria-disabled="true" aria-describedby={why}>
              {choice.label}
            </button>
            <span className="preset-why" id={why}>
              {choice.unavailable}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}
