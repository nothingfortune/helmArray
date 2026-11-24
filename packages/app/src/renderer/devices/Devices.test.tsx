// The keyboard, the mouse and the controller drawn to markup (react-dom/server): what each control
// is called and shows. The clicks and drops are the e2e suite's (packages/app/e2e).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Controller, Keyboard, Mouse } from './Devices';

const RELOAD = { label: 'Reload', role: 'combat' as const, action: 'reload' };
const text = (html: string) => html.replace(/<[^>]+>/g, '');
/** What a screen reader is given: the text, less what is hidden from it. */
const said = (html: string) => text(html.replace(/<span aria-hidden="true">[^<]*<\/span>/g, ''));

describe('the keyboard, drawn', () => {
  it('draws every key as a button in a group called Keyboard', () => {
    const html = renderToStaticMarkup(<Keyboard keys={{}} />);
    expect([
      html.includes('role="group" aria-label="Keyboard"'),
      (html.match(/<button/g) ?? []).length,
    ]).toEqual([true, 75]);
  });

  it('names a key by its cap, then its action, or “not used”', () => {
    const t = text(renderToStaticMarkup(<Keyboard keys={{ 'key.R': RELOAD }} />));
    expect([t.includes('R, Reload'), t.includes('T, not used')]).toEqual([true, true]);
  });

  it('says which of a pair a key is, and a conflict, after its action', () => {
    const t = text(
      renderToStaticMarkup(
        <Keyboard
          keys={{ 'key.LShift': { label: 'Sprint', role: 'movement', action: 'sprint' } }}
          conflicts={new Set(['key.LShift'])}
        />,
      ),
    );
    expect(t).toContain('Shift, Sprint, left one, conflict');
  });

  it('shows a key label on a key too small for the name, and still says the name', () => {
    const html = renderToStaticMarkup(
      <Keyboard
        keys={{
          'key.G': { label: 'Throw the big grenade', role: 'combat', action: 'g', short: 'Nade' },
        }}
      />,
    );
    expect([
      html.includes('<span aria-hidden="true">Nade</span>'),
      said(html).includes('G, Throw the big grenade'),
    ]).toEqual([true, true]);
  });

  it('keeps the name, not the key label, on a key it fits', () => {
    const html = renderToStaticMarkup(
      <Keyboard keys={{ 'key.Space': { ...RELOAD, short: 'Rld' } }} />,
    );
    expect([html.includes('Rld'), text(html).includes('Space, Reload')]).toEqual([false, true]);
  });

  it('never draws a key label under 10 px', () => {
    const html = renderToStaticMarkup(
      <Keyboard keys={{ 'key.G': { label: 'Secondary weapon', role: 'combat', action: 'g' } }} />,
    );
    const sizes = [...html.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length > 0 && sizes.every((s) => s >= 10)).toBe(true);
  });

  it('lets a key with an action be dragged only while it can be edited', () => {
    const editing = renderToStaticMarkup(
      <Keyboard keys={{ 'key.R': RELOAD }} onDropAction={() => undefined} />,
    );
    const shown = renderToStaticMarkup(<Keyboard keys={{ 'key.R': RELOAD }} />);
    expect([
      (editing.match(/draggable="true"/g) ?? []).length,
      shown.includes('draggable'),
    ]).toEqual([1, false]);
  });
});

describe('the mouse, drawn', () => {
  it('has its five buttons as rows, by their short names, and lights the selected one', () => {
    const html = renderToStaticMarkup(
      <Mouse
        keys={{ 'mouse.left': { label: 'Fire', role: 'combat', action: 'fire' } }}
        selected="mouse.left"
      />,
    );
    const t = text(html);
    expect([
      [
        'Left, Fire',
        'Right, Not used',
        'Wheel, Not used',
        'Side 1, Not used',
        'Side 2, Not used',
      ].every((n) => t.includes(n)),
      (html.match(/dv-part is-on/g) ?? []).length,
    ]).toEqual([true, 1]);
  });
});

describe('the controller, drawn', () => {
  it('has a row for each button and stick either side of the drawing, which is not read out', () => {
    const html = renderToStaticMarkup(<Controller keys={{ 'pad.X': RELOAD }} />);
    const t = text(html);
    expect([
      (html.match(/class="dv-r /g) ?? []).length,
      t.includes('X, Reload'),
      t.includes('L stick, Stick'),
      /<svg[^>]*aria-hidden="true"/.test(html),
    ]).toEqual([18, true, true, true]);
  });

  it('lights the part of the selected control', () => {
    const html = renderToStaticMarkup(<Controller keys={{}} selected="pad.DPAD_UP" />);
    expect((html.match(/dv-part is-on/g) ?? []).length).toBe(1);
  });
});
