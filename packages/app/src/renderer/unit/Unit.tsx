// The Azeron unit component. It follows the canvas board docs/design/canvas/Unit.dc.html
// ("Azeron unit", 640 x 380): either hand, mirrored, every Cyborg II position, with the thumb
// keys, the stick and the d-pad each in their own zone. Geometry is in ./layout.ts and label
// fitting in ./label.ts, both pure and tested. The Library, the editor and Play view all draw
// their units with this one component.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ControlId, Hand, Press, Role } from '@helmarray/core';
import { fitLabel } from './label';
import type { LabelFit } from './label';
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
  /** The press that action is on (a button with only a long press shows that). Defaults to tap. */
  press?: Press;
  /** The key's short label: drawn instead of `label` only when `label` won't fit (label.ts). */
  short?: string;
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
/** A key's or chip's border, both sides, at its widest (an empty one's dashed 1.5 px). */
const BORDER = 3;

/**
 * The style of a fitted label: its size and, when it is drawn narrower to fit (`squeeze`), a box
 * as wide as the unsqueezed text needs, scaled into the `width` it has. `origin` is where it stays.
 */
export function labelStyle(fit: LabelFit, width: number, origin: string): CSSProperties {
  const size: CSSProperties = {
    fontSize: px(fit.fontSize),
    ...(fit.lineHeight === undefined ? {} : { lineHeight: fit.lineHeight }),
  };
  if (fit.squeeze >= 1) return size;
  return {
    ...size,
    flex: 'none',
    display: 'inline-block',
    width: px(width / fit.squeeze),
    transform: `scaleX(${fit.squeeze})`,
    transformOrigin: origin,
  };
}
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
      : { draggable: true, onDragStart: dragFrom(id, action.action, action.press ?? 'tap') };

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
    // The text area: the key less its padding (unit.css) and its border.
    const width = k.w - (k.flat ? 17 : 15) - (isPress ? 0 : BORDER);
    const fit = fitLabel(text, width, k.h - pad - (isPress ? 0 : BORDER), {
      ...(isPress ? { sizes: [11, 10] } : {}),
      short: action?.short,
    });
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
        <span className="ul" style={labelStyle(fit, width, isPress ? 'center' : 'left center')}>
          {fit.text}
        </span>
        {assigned && !isPress ? <span className="ud" aria-hidden="true" /> : null}
      </button>
    );
  };

  const renderChip = (c: ChipPlace) => {
    const word = stick?.[c.direction];
    const width = c.w - 8 - BORDER;
    const fit = fitLabel(word || DIRECTION_WORD[c.direction], width, c.h - BORDER, {
      sizes: [12, 11, 10],
      lineHeight: 1.1,
    });
    return (
      <span
        key={c.direction}
        className={`sl ${word ? 'is-assigned' : 'is-empty'}`}
        style={{ ...place(c), ...roleVars(stick?.role) }}
        aria-hidden="true"
      >
        <span className="sl-t" style={labelStyle(fit, width, 'center')}>
          {fit.text}
        </span>
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
