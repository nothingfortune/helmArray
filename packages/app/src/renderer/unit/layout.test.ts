import { describe, expect, it } from 'vitest';
import { CYBORG2_LEFT, CYBORG2_RIGHT } from '@helmarray/core';
import {
  ACTION_DRAG_TYPE,
  FINGER_KEY_WIDTH,
  UNIT_HEIGHT,
  UNIT_WIDTH,
  dragCarriesAction,
  positionName,
  positionOf,
  unitLayout,
  unitScale,
} from './layout';
import type { KeyPlace, Rect } from './layout';

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;
const byId = (keys: KeyPlace[]) => new Map(keys.map((k) => [k.id, k]));

describe('unitLayout: every position', () => {
  it.each([
    ['left', CYBORG2_LEFT],
    ['right', CYBORG2_RIGHT],
  ] as const)('places exactly the controls of the %s Cyborg II', (hand, device) => {
    const placed = unitLayout(hand).keys.map((k) => k.id);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(device.controls.map((c) => c.id).sort());
  });

  it('names the controls by hand: L. on the left unit, R. on the right', () => {
    expect(unitLayout('left').keys.every((k) => k.id.startsWith('L.'))).toBe(true);
    expect(unitLayout('right').keys.every((k) => k.id.startsWith('R.'))).toBe(true);
    expect(positionOf('R.index_1')).toBe('index_1');
  });

  it('keeps every key, zone and chip inside the 640 x 380 board', () => {
    for (const hand of ['left', 'right'] as const) {
      const l = unitLayout(hand);
      const board = { x: 0, y: 0, w: UNIT_WIDTH, h: UNIT_HEIGHT };
      for (const r of [...l.keys, ...l.zones, ...l.chips]) expect(inside(r, board)).toBe(true);
    }
  });
});

describe('unitLayout: mirrored hands', () => {
  const left = unitLayout('left');
  const right = unitLayout('right');
  const leftKeys = byId(left.keys);
  const rightKeys = byId(right.keys);
  // The d-pad's left and right keep their meaning on a mirrored unit, so they trade places.
  const counterpart = (pos: string): string =>
    pos === 'dpad_left' ? 'dpad_right' : pos === 'dpad_right' ? 'dpad_left' : pos;

  it('is a mirror image: same y, w and h, x reflected across the board', () => {
    for (const l of left.keys) {
      const r = rightKeys.get(`R.${counterpart(l.pos)}`);
      expect(r, l.pos).toBeDefined();
      if (!r) continue;
      expect(r.y).toBe(l.y);
      expect(r.w).toBe(l.w);
      expect(r.h).toBe(l.h);
      expect(r.x).toBe(UNIT_WIDTH - l.x - l.w);
    }
  });

  it('mirrors everything except the direction keys exactly where they stand', () => {
    for (const pos of ['index_1', 'pinky_side', 'thumb_aux_upper', 'dpad_up', 'stick']) {
      const l = leftKeys.get(`L.${pos}`);
      const r = rightKeys.get(`R.${pos}`);
      expect(r?.x).toBe(UNIT_WIDTH - (l?.x ?? 0) - (l?.w ?? 0));
    }
    // ← stays on the left of the d-pad cluster and → on the right, on either hand.
    for (const keys of [leftKeys, rightKeys]) {
      const prefix = keys === leftKeys ? 'L' : 'R';
      const x = (pos: string) => keys.get(`${prefix}.${pos}`)?.x ?? NaN;
      expect(x('dpad_left')).toBeLessThan(x('dpad_press'));
      expect(x('dpad_press')).toBeLessThan(x('dpad_right'));
    }
  });

  it('mirrors the zones, and puts the stick chips by direction, left on the left', () => {
    left.zones.forEach((z, i) => {
      const m = right.zones[i];
      expect(m?.name).toBe(z.name);
      expect(m?.x).toBe(UNIT_WIDTH - z.x - z.w);
      expect(m?.y).toBe(z.y);
    });
    for (const l of [left, right]) {
      const chip = (d: string) => l.chips.find((c) => c.direction === d);
      expect(chip('left')?.x ?? NaN).toBeLessThan(chip('right')?.x ?? NaN);
      expect(chip('up')?.x).toBe(chip('down')?.x);
    }
    // The stick's chips follow the stick when the unit is mirrored.
    const stickX = (l: typeof left) => l.keys.find((k) => k.pos === 'stick')?.x ?? NaN;
    const upX = (l: typeof left) => l.chips.find((c) => c.direction === 'up')?.x ?? NaN;
    expect(upX(right) - stickX(right)).toBe(upX(left) - stickX(left));
  });

  it('puts the hand tag at the outer top corner of its own hand', () => {
    expect(left.handTag.side).toBe('left');
    expect(right.handTag.side).toBe('right');
  });
});

describe('unitLayout: the drawn geometry', () => {
  it('draws every finger key 72 px wide', () => {
    for (const hand of ['left', 'right'] as const) {
      const fingers = unitLayout(hand).keys.filter((k) =>
        /^[LR]\.(pinky|ring|middle|index)_\d$/.test(k.id),
      );
      expect(fingers).toHaveLength(20);
      for (const k of fingers) expect(k.w, k.id).toBe(FINGER_KEY_WIDTH);
      expect(FINGER_KEY_WIDTH).toBe(72);
    }
  });

  it('never overlaps two keys (the stick press sits on the stick, by design)', () => {
    const faults: string[] = [];
    for (const hand of ['left', 'right'] as const) {
      const keys = unitLayout(hand).keys;
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = keys[i];
          const b = keys[j];
          if (!a || !b) continue;
          const pressOnStick = [a.shape, b.shape].sort().join() === 'press,stick';
          const press = a.shape === 'press' ? a : b;
          const stick = a.shape === 'press' ? b : a;
          if (pressOnStick && !inside(press, stick))
            faults.push(`${a.id}/${b.id} (${hand}): press is off the stick`);
          if (!pressOnStick && overlap(a, b)) faults.push(`${a.id} vs ${b.id} (${hand}): overlap`);
        }
      }
    }
    expect(faults).toEqual([]);
  });

  it('keeps each cluster in its own zone and the finger keys out of every zone', () => {
    const faults: string[] = [];
    for (const hand of ['left', 'right'] as const) {
      const l = unitLayout(hand);
      const zone = (name: string) => l.zones.find((z) => z.name === name) as Rect;
      for (const k of l.keys) {
        const home = k.pos.startsWith('dpad')
          ? 'D-pad'
          : k.pos.startsWith('thumb')
            ? 'Thumb'
            : k.shape !== 'key'
              ? 'Stick'
              : undefined;
        if (home !== undefined && !inside(k, zone(home)))
          faults.push(`${k.id} (${hand}) is outside ${home}`);
        if (home === undefined)
          for (const z of l.zones)
            if (overlap(k, z)) faults.push(`${k.id} (${hand}) is in ${z.name}`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('keeps the stick chips in the stick zone and off the stick itself', () => {
    for (const hand of ['left', 'right'] as const) {
      const l = unitLayout(hand);
      const stickZone = l.zones.find((z) => z.name === 'Stick') as Rect;
      const stick = l.keys.find((k) => k.shape === 'stick') as Rect;
      const faults = l.chips.flatMap((c) => [
        ...(inside(c, stickZone) ? [] : [`${c.direction} (${hand}) is outside the stick zone`]),
        ...(overlap(c, stick) ? [`${c.direction} (${hand}) sits on the stick`] : []),
      ]);
      expect(faults).toEqual([]);
    }
  });

  it('keeps the zones apart from each other', () => {
    const z = unitLayout('left').zones;
    for (let i = 0; i < z.length; i++)
      for (let j = i + 1; j < z.length; j++)
        expect(overlap(z[i] as Rect, z[j] as Rect)).toBe(false);
  });
});

describe('names', () => {
  it('turns a position into words', () => {
    expect(positionName('index_1')).toBe('Index 1');
    expect(positionName('pinky_side')).toBe('Pinky side');
    expect(positionName('dpad_up')).toBe('D-pad ↑');
    expect(positionName('thumb_aux_lower')).toBe('Thumb lower');
    expect(positionName('stick_press')).toBe('Stick press');
  });
});

describe('unitScale', () => {
  it('prefers an explicit scale, then the container width, then full size', () => {
    expect(unitScale(0.5, 1280)).toBe(0.5);
    expect(unitScale(undefined, 320)).toBe(0.5);
    expect(unitScale(undefined, 1280)).toBe(2);
    expect(unitScale(undefined, undefined)).toBe(1);
  });

  it('never returns zero, negative or not a number', () => {
    expect(unitScale(0, undefined)).toBe(1);
    expect(unitScale(undefined, 0)).toBe(1);
    expect(unitScale(-2, undefined)).toBe(1);
    expect(unitScale(Number.NaN, undefined)).toBe(1);
  });
});

describe('dragCarriesAction', () => {
  it('accepts a drag of type application/x-helm-action and nothing else', () => {
    expect(ACTION_DRAG_TYPE).toBe('application/x-helm-action');
    expect(dragCarriesAction(['text/plain', 'application/x-helm-action'])).toBe(true);
    expect(dragCarriesAction(['Files'])).toBe(false);
    expect(dragCarriesAction([])).toBe(false);
    expect(dragCarriesAction(undefined)).toBe(false);
  });
});

describe('positionName for a position named like an Object property', () => {
  it('words constructor as a name, not as Object', () => {
    expect(positionName('constructor')).toBe('Constructor');
  });
});
