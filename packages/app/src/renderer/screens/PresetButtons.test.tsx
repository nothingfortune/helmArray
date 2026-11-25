import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PresetButtons } from './PresetButtons';
import { presetChoices } from './libraryView';

const ES2 = presetChoices({ name: 'Everspace 2', nativeKeys: true, needsKeyStick: true });
const ROVER = presetChoices({ name: 'Rover', nativeKeys: true, needsKeyStick: false });

describe('the presets a scheme starts from', () => {
  it('shows Xbox controller off for a game that plays on keys, with why as its description', () => {
    const html = renderToStaticMarkup(
      <PresetButtons choices={ES2} onChoose={vi.fn()} idPrefix="start-es2" />,
    );
    expect(html).toBe(
      '<button type="button" class="btn" aria-disabled="true" aria-describedby="start-es2-xbox-why">Xbox controller</button>' +
        '<span class="preset-why" id="start-es2-xbox-why">Everspace 2 plays on keys: it stutters when a controller and keys are mixed.</span>' +
        '<button type="button" class="btn">Game&#x27;s own keys</button>',
    );
  });

  it('makes the first one on the primary button, when asked', () => {
    const html = (choices: typeof ES2) =>
      renderToStaticMarkup(
        <PresetButtons choices={choices} onChoose={vi.fn()} idPrefix="gm" primary />,
      );
    expect([
      html(ES2).match(/class="btn primary">[^<]*/g),
      html(ROVER).match(/class="btn primary">[^<]*/g),
    ]).toEqual([
      ['class="btn primary">Game&#x27;s own keys'],
      ['class="btn primary">Xbox controller'],
    ]);
  });

  it('turns every choice off while busy', () => {
    const html = renderToStaticMarkup(
      <PresetButtons choices={ROVER} onChoose={vi.fn()} idPrefix="gm" busy />,
    );
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it('chooses a preset that is on, and nothing for one that is off', () => {
    const onChoose = vi.fn();
    const tree = PresetButtons({ choices: ES2, onChoose, idPrefix: 'x' });
    const buttons: { props: { onClick?: () => void; children?: unknown } }[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      const el = n as { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
      if (el?.props === undefined) return;
      if (el.type === 'button') buttons.push(el as (typeof buttons)[number]);
      walk(el.props.children);
    };
    walk(tree);
    for (const b of buttons) b.props.onClick?.();
    expect([buttons.length, onChoose.mock.calls]).toEqual([2, [['keys']]]);
  });
});
