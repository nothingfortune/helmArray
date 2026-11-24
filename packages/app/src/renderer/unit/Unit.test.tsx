// The Azeron unit drawn to markup (react-dom/server): what its labels show and at what size. The
// rendered sizes, scaled, are the e2e suite's (packages/app/e2e/layout.spec.ts).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { helldivers2 } from '@helmarray/core';
import { Unit, labelStyle } from './Unit';
import type { UnitKey } from './Unit';
import { unitLayout } from './layout';
import { fitLabel } from './label';

const sizes = (html: string) =>
  [...html.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));

/** Every position of the left unit, each with a Helldivers 2 action, round and round. */
function everyKey(): Record<string, UnitKey> {
  const actions = helldivers2.actions;
  return Object.fromEntries(
    unitLayout('left').keys.map((k, i) => {
      const a = actions[i % actions.length];
      return [k.id, { label: a?.name ?? '', action: a?.id ?? '' }];
    }),
  );
}

describe('the unit, drawn', () => {
  it('draws no label under 10 px, keys, the stick press and its chips alike', () => {
    const html = renderToStaticMarkup(
      <Unit
        hand="left"
        keys={everyKey()}
        stick={{
          up: 'Move forward',
          down: 'Move back',
          left: 'Strafe left',
          right: 'Strafe right',
        }}
        scale={1}
      />,
    );
    const found = sizes(html);
    expect([found.length > 30, found.filter((s) => s < 10)]).toEqual([true, []]);
  });

  it('shows the key label on a key too small for the name, and says the name', () => {
    const html = renderToStaticMarkup(
      <Unit
        hand="left"
        keys={{ 'L.dpad_up': { label: 'Ping / comms wheel', action: 'ping', short: 'Ping' } }}
        scale={1}
      />,
    );
    expect([
      html.includes('>Ping</span>'),
      html.includes('aria-label="Ping / comms wheel, d-pad ↑"'),
    ]).toEqual([true, true]);
  });

  it('keeps the name on a key it fits, though it has a key label', () => {
    const html = renderToStaticMarkup(
      <Unit hand="left" keys={{ 'L.index_1': { label: 'Fire', action: 'fire', short: 'F' } }} />,
    );
    expect(html).toContain('>Fire</span>');
  });

  it('keeps "D-pad ←" on an empty key in one piece', () => {
    const html = renderToStaticMarkup(<Unit hand="left" keys={{}} scale={1} />);
    expect(html).toContain('>D-\u2060pad\u00a0←</span>');
  });
});

describe('labelStyle', () => {
  it('draws the lines closer when the fit asks for it', () => {
    expect(labelStyle(fitLabel('Ping / comms wheel', 38, 31), 38, 'left center')).toMatchObject({
      fontSize: '10px',
      lineHeight: 1,
    });
  });

  it('sets only the size of a label drawn at its own width', () => {
    expect(labelStyle(fitLabel('Fire', 56, 38), 56, 'left center')).toEqual({ fontSize: '13px' });
  });

  it('draws a squeezed label in a box as wide as its text needs, scaled into the width it has', () => {
    const fit = fitLabel('Extraordinarily', 56, 38);
    expect(labelStyle(fit, 56, 'center')).toEqual({
      fontSize: '10px',
      flex: 'none',
      display: 'inline-block',
      width: `${56 / fit.squeeze}px`,
      transform: `scaleX(${fit.squeeze})`,
      transformOrigin: 'center',
    });
  });
});
