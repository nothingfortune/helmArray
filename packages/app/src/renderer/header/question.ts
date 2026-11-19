import type { HandQuestion } from '../../shared/api';

export interface QuestionView {
  prompt: string;
  /** The unit the Left / Right buttons answer for; null when the app detects the press itself. */
  chooseFor: number | null;
}

export function questionView(question: HandQuestion): QuestionView | null {
  if (question === null) return null;
  return {
    prompt: question.prompt,
    chooseFor: question.kind === 'choose' ? question.unitId : null,
  };
}
