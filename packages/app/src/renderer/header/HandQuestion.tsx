import type { Hand, HandQuestion as HandQuestionState } from '../../shared/api';
import { questionView } from './question';

/**
 * The app asking which hand a unit is. A press needs no click (the main process sees it);
 * a lone new unit needs one, on Left or Right.
 */
export function HandQuestion({
  question,
  onChoose,
}: {
  question: HandQuestionState;
  onChoose: (unitId: number, hand: Hand) => void;
}) {
  const view = questionView(question);
  if (view === null) return null;
  const { chooseFor } = view;
  return (
    <div className="question" role="status">
      <span>{view.prompt}</span>
      {chooseFor !== null && (
        <span className="question-buttons">
          <button type="button" className="btn" onClick={() => onChoose(chooseFor, 'left')}>
            Left
          </button>
          <button type="button" className="btn" onClick={() => onChoose(chooseFor, 'right')}>
            Right
          </button>
        </span>
      )}
    </div>
  );
}
