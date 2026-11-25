import { describe, expect, it } from 'vitest';
import { Saves } from './saves';

describe('what main has taken of a document saved as it is edited', () => {
  it('goes back to what main took last when the latest save is refused', () => {
    const saves = new Saves('loaded');
    const a = saves.send();
    saves.took(a, 'a');
    const b = saves.send();
    expect([saves.refused(b), saves.taken]).toEqual(['a', 'a']);
  });

  it('goes back to what it was opened on when main has taken nothing yet', () => {
    const saves = new Saves('loaded');
    expect(saves.refused(saves.send())).toBe('loaded');
  });

  it('waits on a refusal while a later save may still be taken', () => {
    const saves = new Saves('loaded');
    const a = saves.send();
    const b = saves.send();
    const early = saves.refused(a);
    saves.took(b, 'b');
    expect([early, saves.taken]).toEqual([null, 'b']);
  });

  it('never goes back to an older document taken after a newer one', () => {
    const saves = new Saves('loaded');
    const a = saves.send();
    const b = saves.send();
    saves.took(b, 'b');
    saves.took(a, 'a');
    expect(saves.taken).toBe('b');
  });

  it('goes back to the newest taken, once a refusal is the latest save', () => {
    const saves = new Saves('loaded');
    const a = saves.send();
    const b = saves.send();
    saves.took(a, 'a');
    expect(saves.refused(b)).toBe('a');
  });
});
