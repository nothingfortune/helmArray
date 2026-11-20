// The Azeron unit component. It follows the canvas board docs/design/canvas/Unit.dc.html
// ("Azeron unit", 640 x 380): either hand, mirrored, every Cyborg II position, with the thumb
// keys, the stick and the d-pad each in their own zone. Geometry is in ./layout.ts and label
// fitting in ./label.ts, both pure and tested. The Library, the editor and Play view all draw
// their units with this one component.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import type { ControlId, Hand, Role } from '@helmarray/core';
import { fitLabel } from './label';
import {
  ACTION_DRAG_TYPE,
  UNIT_HEIGHT,
  UNIT_WIDTH,
  dragCarriesAction,
  unitLayout,
  unitScale,
} from './layout';
import type { ChipPlace, KeyPlace, StickDirection } from './layout';
import './unit.css';

export interface UnitKey {
  /** The action's name in the game's words. */
  label: string;
  role?: Role;
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
  /** An action dragged from the action list and dropped on a control. */
  onDropAction?: (control: ControlId, actionId: string) => void;
  /** Fixed scale. Without it the board fills its container's width. */
  scale?: number;
  className?: string;
}

const ROLE_COLOURS: Record<Role, { dot: string; tint: string }> = {
  combat: { dot: 'var(--color-combat)', tint: 'var(--color-combat-tint)' },
  movement: { dot: 'var(--color-movement)', tint: 'var(--color-movement-tint)' },
  ability: { dot: 'var(--color-ability)', tint: 'var(--color-ability-tint)' },
  travel: { dot: 'var(--color-travel)', tint: 'var(--color-travel-tint)' },
  menu: { dot: 'var(--color-menu)', tint: 'var(--color-menu-tint)' },
};
// An action with no role yet: a plain key, not a guess at a colour.
const NO_ROLE = { dot: 'var(--color-muted)', tint: 'var(--color-raised)' };

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

function roleVars(role: Role | undefined): CSSProperties {
  const c = role === undefined ? NO_ROLE : ROLE_COLOURS[role];
  return { '--role': c.dot, '--tint': c.tint } as CSSProperties;
}

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

  const dropHandlers = (id: ControlId) =>
    onDropAction === undefined
      ? {}
      : {
          onDragOver: (e: DragEvent) => {
            if (!dragCarriesAction(e.dataTransfer.types)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropTarget(id);
          },
          onDragLeave: (e: DragEvent) => {
            // Moving onto the key's own label is not leaving the key.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setDropTarget(null);
            const actionId = e.dataTransfer.getData(ACTION_DRAG_TYPE);
            if (actionId !== '') onDropAction(id, actionId);
          },
        };

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
          {...dropHandlers(k.id)}
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
        {...dropHandlers(k.id)}
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
