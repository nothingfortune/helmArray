// The Azeron unit component. It follows the canvas board docs/design/canvas/Unit.dc.html
// ("Azeron unit", 640 x 380): either hand, mirrored, every Cyborg II position, with the thumb
// keys, the stick and the d-pad each in their own zone. Geometry is in ./layout.ts and label
// fitting in ./label.ts, both pure and tested. The Library, the editor and Play view all draw
// their units with this one component.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ControlId, Hand, Role } from '@helmarray/core';
import { fitLabel } from './label';
import { roleVars } from './role';
import { dragFrom, dropHandlers } from '../devices/drag';
import type { DropAction } from '../devices/drag';
import { UNIT_HEIGHT, UNIT_WIDTH, unitLayout, unitScale } from './layout';
import type { ChipPlace, KeyPlace, StickDirection } from './layout';
import './unit.css';

export interface UnitKey {
  /** The action's name in the game's words. */
  label: string;
  role?: Role;
  /** The action's id: a key with one can be dragged to another control. */
  action?: string;
}

/** What the stick's four directions send, shown as chips around it. */
export interface StickLabels {
  up?: string;
  down?: string;
  left?: string;
  right?: string;
  role?: Role;
}

export interface UnitProps {
  hand: Hand;
  /** Control id (`L.index_1`) to its action. A missing or undefined entry draws an empty key. */
  keys: Readonly<Record<ControlId, UnitKey | undefined>>;
  stick?: StickLabels;
  selected?: ControlId;
  /** Controls being pressed right now. */
  lit?: ReadonlySet<ControlId>;
  /** Controls that clash with another assignment. */
  conflicts?: ReadonlySet<ControlId>;
  onSelect?: (id: ControlId) => void;
  /**
   * An action dropped on a control: from the action list, or dragged off another control (`from`),
   * which moves it. Without it nothing is a drop target and no key can be dragged.
   */
  onDropAction?: DropAction;
  /** Fixed scale. Without it the board fills its container's width. */
  scale?: number;
  className?: string;
}

const DIRECTION_WORD: Record<StickDirection, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

const px = (n: number): string => `${n}px`;
const place = (p: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  left: px(p.x),
  top: px(p.y),
  width: px(p.w),
  height: px(p.h),
});

export function Unit({
  hand,
  keys,
  stick,
  selected,
  lit,
  conflicts,
  onSelect,
  onDropAction,
  scale,
  className,
}: UnitProps) {
  const layout = unitLayout(hand);
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostWidth, setHostWidth] = useState<number | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<ControlId | null>(null);

  const fixed = scale !== undefined;
  useEffect(() => {
    const host = hostRef.current;
    if (fixed || host === null) return;
    const watcher = new ResizeObserver(([entry]) => setHostWidth(entry?.contentRect.width));
    watcher.observe(host);
    return () => watcher.disconnect();
  }, [fixed]);
  const s = unitScale(scale, hostWidth);

  const drops = (id: ControlId) =>
    onDropAction === undefined ? {} : dropHandlers(id, onDropAction, setDropTarget);
  const drags = (id: ControlId, action: UnitKey | undefined) =>
    onDropAction === undefined || action?.action === undefined
      ? {}
      : { draggable: true, onDragStart: dragFrom(id, action.action) };

  const stateClasses = (id: ControlId): string[] => [
    ...(selected === id ? ['is-selected'] : []),
    ...(lit?.has(id) ? ['is-lit'] : []),
    ...(conflicts?.has(id) ? ['is-conflict'] : []),
    ...(dropTarget === id ? ['is-drop'] : []),
  ];
  const stateWords = (id: ControlId): string =>
    (conflicts?.has(id) ? ', conflict' : '') + (lit?.has(id) ? ', pressed' : '');

  const renderKey = (k: KeyPlace) => {
    const action = keys[k.id];
    const assigned = action !== undefined;
    const isPress = k.shape === 'press';
    const text = assigned ? action.label : isPress ? 'Press' : k.name;
    const pad = isPress ? 0 : k.flat ? 8 : 10;
    const fit = fitLabel(
      text,
      k.w - (k.flat ? 17 : 16),
      k.h - pad,
      isPress ? { sizes: [11, 10, 9] } : {},
    );
    const classes = [
      'uk',
      `shape-${k.shape}`,
      assigned ? 'is-assigned' : 'is-empty',
      ...(k.flat ? ['flat'] : []),
      ...stateClasses(k.id),
    ];
    if (k.shape === 'stick') {
      const dirs = (['up', 'down', 'left', 'right'] as const).flatMap((d) => {
        const word = stick?.[d];
        return word ? [`${d} ${word}`] : [];
      });
      return (
        <button
          key={k.id}
          type="button"
          className={classes.join(' ')}
          style={place(k)}
          aria-label={`${dirs.length > 0 ? `Stick, ${dirs.join(', ')}` : 'Stick, empty'}${stateWords(k.id)}`}
          aria-current={selected === k.id ? 'true' : undefined}
          onClick={() => onSelect?.(k.id)}
          {...drops(k.id)}
        />
      );
    }
    return (
      <button
        key={k.id}
        type="button"
        className={classes.join(' ')}
        style={{ ...place(k), ...roleVars(action?.role) }}
        aria-label={`${assigned ? action.label : 'Empty'}, ${k.name.toLowerCase()}${stateWords(k.id)}`}
        aria-current={selected === k.id ? 'true' : undefined}
        onClick={() => onSelect?.(k.id)}
        {...drops(k.id)}
        {...drags(k.id, action)}
      >
        <span className="ul" style={{ fontSize: px(fit.fontSize) }}>
          {text}
        </span>
        {assigned && !isPress ? <span className="ud" aria-hidden="true" /> : null}
      </button>
    );
  };

  const renderChip = (c: ChipPlace) => {
    const word = stick?.[c.direction];
    const fit = fitLabel(word || DIRECTION_WORD[c.direction], c.w - 8, c.h - 2, {
      sizes: [12, 11, 10, 9],
      lineHeight: 1.1,
    });
    return (
      <span
        key={c.direction}
        className={`sl ${word ? 'is-assigned' : 'is-empty'}`}
        style={{ ...place(c), ...roleVars(stick?.role), fontSize: px(fit.fontSize) }}
        aria-hidden="true"
      >
        {word || DIRECTION_WORD[c.direction]}
      </span>
    );
  };

  return (
    <div
      ref={hostRef}
      className={`unit-host${className ? ` ${className}` : ''}`}
      style={
        fixed
          ? { width: px(UNIT_WIDTH * s), height: px(UNIT_HEIGHT * s) }
          : { width: '100%', aspectRatio: `${UNIT_WIDTH} / ${UNIT_HEIGHT}` }
      }
    >
      <div
        className="unit"
        data-hand={hand}
        style={{ width: px(UNIT_WIDTH), height: px(UNIT_HEIGHT), transform: `scale(${s})` }}
      >
        <span
          className="unit-hand"
          style={{ [layout.handTag.side]: px(layout.handTag.x), top: px(layout.handTag.y) }}
        >
          {hand === 'right' ? 'Right' : 'Left'}
        </span>
        {layout.zones.map((z) => (
          <div key={z.name}>
            <div className="zn" style={place(z)} />
            <span className="zh" style={{ left: px(z.x + 12), top: px(z.y + 9) }}>
              {z.name}
            </span>
          </div>
        ))}
        {layout.keys.map(renderKey)}
        {layout.chips.map(renderChip)}
      </div>
    </div>
  );
}
