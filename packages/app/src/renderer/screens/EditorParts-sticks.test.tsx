// The parts the audit's wave 2 changed, drawn to markup: grouped checks, the stick's directions in
// the side panel, the actions on the stick, and the controller's stick rows.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Game, PadControl, Scheme } from '@helmarray/core';
import {
  BUILT_IN_DEVICES,
  blankKeysScheme,
  gameKeysPreset,
  helldivers2,
  resolve,
  xboxControllerPreset,
} from '@helmarray/core';
import { editorView } from './editor-view';
import type { DeviceTabId } from './editor-view';
import { Checks, DeviceArea, Panel, Unplaced } from './EditorParts';

const none = () => undefined;
const view = (scheme: Scheme, selected?: string, tab?: DeviceTabId) =>
  editorView({
    scheme,
    game: helldivers2,
    plan: resolve(scheme, helldivers2, BUILT_IN_DEVICES),
    mode: 'default',
    selected,
    tab,
  });
const checks = (scheme: Scheme) =>
  renderToStaticMarkup(
    <Checks
      view={view(scheme)}
      onFix={none}
      onKeep={none}
      onFlag={none}
      onFixAll={none}
      onKeepAll={none}
    />,
  );

describe('grouped checks', () => {
  const html = checks(blankKeysScheme(helldivers2));

  it('say the group in one line, its subject bold, with one fix and one Keep, I know', () => {
    expect([
      html.includes('<strong class="ed-check-subject">4 movement actions</strong>'),
      html.includes('Put them on buttons'),
      html.includes('<summary>Show each</summary>'),
    ]).toEqual([true, true, true]);
  });

  it('keep each finding under Show each, with its own fix', () => {
    const each = html.slice(html.indexOf('<summary>Show each</summary>'));
    expect((each.match(/Put it on a button/g) ?? []).length).toBe(6);
  });

  it('give the sticks their fix', () => {
    expect([
      html.includes('Give it the movement keys'),
      html.includes('Use it as the mouse'),
    ]).toEqual([true, true]);
  });
});

describe('the stick in the side panel', () => {
  const draw = (scheme: Scheme, control: string) => {
    const p = view(scheme, control).panel;
    if (p === null) throw new Error('no panel');
    return renderToStaticMarkup(
      <Panel
        panel={p}
        onClose={none}
        onMode={none}
        onTarget={none}
        onChoose={none}
        onClear={none}
        onTurbo={none}
        onLatch={none}
        onPad={none}
        onKeyLabel={none}
      />,
    );
  };

  it('lists its four directions, each with its action, and no longer says it can’t', () => {
    const html = draw(xboxControllerPreset(helldivers2), 'L.stick');
    expect([
      html.includes('Directions'),
      ['Move forward', 'Move back', 'Strafe left', 'Strafe right'].every((n) => html.includes(n)),
      html.includes('isn&#x27;t possible here yet'),
    ]).toEqual([true, true, false]);
  });
});

describe('the actions on the stick', () => {
  it('are listed apart, under On the stick, not under Not on a button', () => {
    const html = renderToStaticMarkup(
      <Unplaced
        view={view(gameKeysPreset(helldivers2))}
        modeName="Default"
        prompt={null}
        onPlace={none}
      />,
    );
    const stick = html.slice(html.indexOf('On the stick'));
    expect([html.indexOf('On the stick') > 0, stick.includes('Move forward')]).toEqual([
      true,
      true,
    ]);
  });
});

describe('the controller’s sticks', () => {
  it('name the actions on their directions on the Controller tab', () => {
    const scheme: Scheme = {
      ...xboxControllerPreset(helldivers2),
      devices: { azerons: 'none', keyboard: false, mouse: false, controller: true },
    };
    const v = view(scheme, undefined, 'controller');
    const html = renderToStaticMarkup(
      <DeviceArea view={v} selected={undefined} onSelect={none} onDropAction={none} />,
    );
    expect(html).toContain('Move forward, Move back, Strafe left, Strafe right');
  });
});

describe('a check whose fix can’t act', () => {
  it('says why in one sentence, and draws no fix button', () => {
    const pads = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'LS', 'RS'];
    const crowded: Game = {
      id: 'crowded',
      name: 'Crowded',
      modes: [{ id: 'default', name: 'Default' }],
      actions: [...pads, 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', null].map((pad, i) => ({
        id: `a${i}`,
        name: `Action ${i}`,
        mode: 'default',
        role: 'combat',
        required: true,
        native: pad === null ? {} : { pad: pad as PadControl },
      })),
    };
    const scheme = xboxControllerPreset(crowded);
    const v = editorView({
      scheme,
      game: crowded,
      plan: resolve(scheme, crowded, BUILT_IN_DEVICES),
      mode: 'default',
    });
    const html = renderToStaticMarkup(
      <Checks view={v} onFix={none} onKeep={none} onFlag={none} onFixAll={none} onKeepAll={none} />,
    );
    expect([
      html.includes('Every controller button is in use; clear one first.'),
      html.includes('Put it on a button'),
      html.includes('Keep, I know'),
    ]).toEqual([true, false, true]);
  });
});

describe('a finding row, to click', () => {
  it('draws its sentence as a button that shows where it is; a setup-wide one stays text', () => {
    const scheme: Scheme = {
      ...xboxControllerPreset(helldivers2),
      devices: { azerons: 'both', keyboard: true, mouse: true, controller: false },
      map: { default: {} },
    };
    const html = checks(scheme);
    // Required actions on no button: each a button. The mix of devices: no place to show.
    expect([
      /<button type="button" class="ed-check-go"[^>]*>.*?Fire/.test(html),
      /<button type="button" class="ed-check-go"[^>]*><span class="ed-check-text"><strong class="ed-check-subject"><\/strong>This scheme mixes/.test(
        html,
      ),
      html.includes('This scheme mixes'),
    ]).toEqual([true, false, true]);
  });
});
