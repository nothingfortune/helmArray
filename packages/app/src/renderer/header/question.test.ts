import { describe, expect, it } from 'vitest';
import { questionView } from './question';

describe('questionView', () => {
  it('shows nothing when there is no question', () => {
    expect(questionView(null)).toBeNull();
  });

  it('a press question is only its prompt: no buttons', () => {
    expect(questionView({ kind: 'press', prompt: 'Press any key on the left unit.' })).toEqual({
      prompt: 'Press any key on the left unit.',
      chooseFor: null,
    });
  });

  it('a choose question carries the unit the buttons answer for', () => {
    expect(questionView({ kind: 'choose', unitId: 49229, prompt: 'Which hand is this?' })).toEqual({
      prompt: 'Which hand is this?',
      chooseFor: 49229,
    });
  });

  it('a unit with id 0 still gets its buttons', () => {
    expect(questionView({ kind: 'choose', unitId: 0, prompt: 'Which hand?' })?.chooseFor).toBe(0);
  });
});
