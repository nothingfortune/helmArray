// The Editor's parts drawn to markup (react-dom/server), from views worked out by editorView: what
// each part shows for each state of the view. The clicks are the e2e suite's (packages/app/e2e).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Scheme } from '@helmarray/core';
import { AZERONS_ONLY } from '@helmarray/core';
import { assign } from './editor-model';
import { editorView } from './editor-view';
import type { DeviceTabId } from './editor-view';
import {
  BackLink,
  Checks,
  DeviceArea,
  DevicesChooser,
  Panel,
  SchemePicker,
  Unplaced,
} from './EditorParts';
import type { PickerActions } from './EditorParts';
import { game, keysScheme, padGame, padScheme, plan } from './editor-fixture';

const none = () => undefined;
const view = (scheme: Scheme, selected?: string, tab?: DeviceTabId) =>
  editorView({ scheme, game: padGame, plan: plan(scheme, padGame), mode: 'ship', selected, tab });
const withDevices = (scheme: Scheme, devices: Partial<Scheme['devices']>): Scheme => ({
  ...scheme,
  devices: { ...AZERONS_ONLY, ...devices },
});
const area = (scheme: Scheme, tab?: DeviceTabId, selected?: string, width?: number) =>
  renderToStaticMarkup(
    <DeviceArea
      view={view(scheme, selected, tab)}
      width={width}
      selected={selected}
      onSelect={none}
      onDropAction={none}
    />,
  );
const panel = (scheme: Scheme, selected: string, tab?: DeviceTabId) => {
  const p = view(scheme, selected, tab).panel;
  if (p === null) throw new Error('no panel');
  return renderToStaticMarkup(
    <Panel
      panel={p}
      onClose={none}
      onMode={none}
      onTarget={none}
      onClear={none}
      onTurbo={none}
      onLatch={none}
      onPad={none}
      onKeyLabel={none}
    />,
  );
};
const count = (html: string, text: string) => html.split(text).length - 1;

describe('the device area', () => {
  it('draws both units on the Azerons tab', () => {
    const html = area(keysScheme());
    expect([count(html, 'data-hand="left"'), count(html, 'data-hand="right"')]).toEqual([1, 1]);
  });

  it('draws the left unit and the mouse, and no right unit, for a left Azeron + mouse setup', () => {
    const html = area(withDevices(keysScheme(), { azerons: 'left', mouse: true }));
    expect([
      count(html, 'data-hand="left"'),
      count(html, 'data-hand="right"'),
      html.includes('aria-label="Mouse"'),
    ]).toEqual([1, 0, true]);
  });

  it('draws the keyboard with the mouse on the Keyboard tab, and a key’s action', () => {
    const scheme = {
      ...withDevices(keysScheme(), { keyboard: true, mouse: true }),
      map: { ship: { 'key.J': { tap: 'fsd' } }, srv: {} },
    };
    const html = area(scheme, 'keyboard', 'key.J');
    const unplaced = renderToStaticMarkup(
      <Unplaced
        view={view(scheme, undefined, 'keyboard')}
        modeName="Ship"
        prompt={null}
        onPlace={none}
      />,
    );
    expect([
      html.includes('aria-label="Keyboard"'),
      html.includes('aria-label="Mouse"'),
      html.includes('Frame shift drive'),
      count(html, 'is-selected'),
      unplaced.includes('Not on a key or mouse button · Ship'),
    ]).toEqual([true, true, true, 1, true]);
  });

  it('draws only the mouse on a mouse tab with no keyboard', () => {
    const html = area(withDevices(keysScheme(), { azerons: 'none', mouse: true }), 'keyboard');
    expect([html.includes('aria-label="Keyboard"'), html.includes('aria-label="Mouse"')]).toEqual([
      false,
      true,
    ]);
  });

  it('draws the controller on its tab, with what each button does and its sticks', () => {
    const scheme = withDevices(padScheme(), { controller: true });
    const html = area(scheme, 'controller', 'pad.RT');
    expect([
      html.includes('aria-label="Controller, left side"'),
      html.includes('Fire'),
      count(html, 'Stick'),
      html.includes('dv-part is-on'),
    ]).toEqual([true, true, 2, true]);
  });

  it('says what to do for a setup with no devices', () => {
    expect(area(withDevices(keysScheme(), { azerons: 'none' }))).toContain(
      'This scheme has no devices.',
    );
  });
});

describe('the checks', () => {
  const draw = (scheme: Scheme) =>
    renderToStaticMarkup(<Checks view={view(scheme)} onFix={none} onKeep={none} onFlag={none} />);

  it('says there is nothing to fix', () => {
    expect(draw(padScheme())).toContain('Nothing to fix.');
  });

  it('lists a finding with its fix and Keep, I know; a kept one under the kept list', () => {
    // Latch on a movement button: a warning with a fix.
    const latched = { ...keysScheme(), behaviour: { 'L.index_1': { latch: true } } };
    const html = draw(latched);
    const kept = draw({
      ...latched,
      accepted: [{ rule: 'hold-on-movement', control: 'L.index_1', reason: 'Kept on purpose' }],
    });
    expect([
      html.includes('Turn off hold to latch'),
      html.includes('Keep, I know'),
      kept.includes('1 kept'),
      kept.includes('Flag it again'),
    ]).toEqual([true, true, true, true]);
  });
});

describe('the side panel', () => {
  it('shows an Azeron button with key output: every press, turbo and latch, and what it sends', () => {
    const html = panel(keysScheme(), 'L.index_1');
    expect([
      html.includes('Left · Index 1'),
      html.includes('Long'),
      html.includes('Turbo'),
      html.includes('Left Shift'),
      html.includes('<select'),
    ]).toEqual([true, true, true, true, false]);
  });

  it('with controller output, offers the Xbox control the button sends as a choice', () => {
    const html = panel(padScheme(), 'L.index_1');
    expect([
      html.includes('<select'),
      html.includes('Xbox A · Frame shift drive'),
      html.includes('Not on a controller'),
    ]).toEqual([true, true, true]);
  });

  it('offers “Nothing yet” for a button that sends nothing', () => {
    expect(panel(padScheme(), 'L.index_4')).toContain('Nothing yet');
  });

  it('shows a button kept on a stick’s direction as the stick’s own, with no choice', () => {
    const scheme: Scheme = {
      ...padScheme(),
      padMap: { ...padScheme().padMap, 'L.index_4': 'LS_UP' },
      map: { ship: { 'L.index_4': { tap: 'boost' } }, srv: {} },
    };
    const html = panel(scheme, 'L.index_4');
    expect([html.includes('<select'), html.includes('the stick’s own direction')]).toEqual([
      false,
      true,
    ]);
  });

  it('shows a key with a tap only and no turbo or latch', () => {
    const scheme = {
      ...withDevices(keysScheme(), { keyboard: true, mouse: true }),
      map: { ship: { 'key.J': { tap: 'fsd' } }, srv: {} },
    };
    const html = panel(scheme, 'key.J', 'keyboard');
    expect([
      html.includes('Keyboard · J'),
      html.includes('Not on a key'),
      html.includes('Turbo'),
    ]).toEqual([true, true, false]);
  });

  it('shows the stick as a stick', () => {
    expect(panel(padScheme(), 'L.stick')).toContain('The stick sends its four directions.');
  });

  it('shows the button in every mode', () => {
    const html = panel(keysScheme(), 'L.index_1');
    expect([html.includes('In each mode'), html.includes('Jump')]).toEqual([true, true]);
  });
});

describe('the actions not on a button', () => {
  it('lists them, with what a click does', () => {
    const html = renderToStaticMarkup(
      <Unplaced
        view={view(keysScheme())}
        modeName="Ship"
        prompt="Click an action to put it on Left · Index 2, tap."
        onPlace={none}
      />,
    );
    expect([
      html.includes('Galaxy map'),
      html.includes('Click an action'),
      html.includes('draggable="true"'),
    ]).toEqual([true, true, true]);
  });

  it('says every action is on a button when none is left', () => {
    const all = game.actions
      .filter((a) => a.mode === 'ship')
      .reduce(
        (s, a, i) =>
          assign(
            s,
            { mode: 'ship', control: `L.ring_${(i % 5) + 1}`, press: i < 5 ? 'tap' : 'long' },
            a.id,
            game,
          ),
        { ...keysScheme(), map: { ship: {}, srv: {} } } as Scheme,
      );
    const v = editorView({ scheme: all, game, plan: plan(all), mode: 'ship' });
    const html = renderToStaticMarkup(
      <Unplaced view={v} modeName="Ship" prompt={null} onPlace={none} />,
    );
    expect(html).toContain('Every Ship action is on a button.');
  });
});

describe('the header’s parts', () => {
  const actions: PickerActions = {
    switchTo: none,
    make: none,
    copy: none,
    rename: none,
    remove: none,
  };

  it('the Scheme picker is a button naming the setup open, or only its name with nothing to do', () => {
    const live = renderToStaticMarkup(
      <SchemePicker scheme={keysScheme()} game={game} actions={actions} />,
    );
    const still = renderToStaticMarkup(
      <SchemePicker scheme={keysScheme()} game={game} actions={null} />,
    );
    expect([
      live.includes('<button'),
      live.includes('Scheme: Main'),
      still.includes('<button'),
    ]).toEqual([true, true, false]);
  });

  it('the device chooser and the way back are buttons', () => {
    expect(
      [
        renderToStaticMarkup(<DevicesChooser devices={AZERONS_ONLY} onChange={none} />),
        renderToStaticMarkup(<BackLink onBack={none} />),
      ].map((html) => html.startsWith('<button')),
    ).toEqual([true, true]);
  });
});

describe('the key label field', () => {
  const labelled: Scheme = { ...keysScheme(), keyLabels: { ship: { 'L.middle_1': 'FSD' } } };

  it('is under Press for a button with an action: its label, the name as the hint, and what it is for', () => {
    const html = panel(labelled, 'L.middle_1');
    expect([
      html.includes('<label class="ed-lbl" for="ed-key-label">Key label</label>'),
      html.includes('value="FSD"'),
      html.includes('placeholder="Frame shift drive"'),
      html.includes('aria-describedby="ed-key-label-hint"'),
      html.indexOf('Key label') > html.indexOf('>Press<'),
    ]).toEqual([true, true, true, true, true]);
  });

  it('is not there for an empty button', () => {
    expect(panel(labelled, 'L.index_4')).not.toContain('Key label');
  });
});

describe('the device area at a measured width', () => {
  const kbm = (scheme: Scheme): Scheme => ({
    ...withDevices(scheme, { keyboard: true, mouse: true }),
    map: { ship: { 'key.J': { tap: 'fsd' } }, srv: {} },
  });

  it('draws the two units side by side at the scale the width gives', () => {
    const html = area(keysScheme(), undefined, undefined, 915);
    expect([
      html.includes('class="ed-units"'),
      count(html, 'ed-unit is-scaled'),
      count(html, `scale(${(915 - 20) / 2 / 640})`),
    ]).toEqual([true, 2, 2]);
  });

  it('stacks them when two would be too small to read', () => {
    expect(area(keysScheme(), undefined, undefined, 700)).toContain('ed-units is-stacked');
  });

  it('puts the mouse under the keyboard when beside it the keyboard would be under 0.8', () => {
    const narrow = area(kbm(keysScheme()), 'keyboard', undefined, 915);
    const wide = area(kbm(keysScheme()), 'keyboard', undefined, 1100);
    expect([
      narrow.includes('ed-kbm is-below'),
      narrow.includes('width:915px'),
      wide.includes('ed-kbm is-below'),
    ]).toEqual([true, true, false]);
  });
});
