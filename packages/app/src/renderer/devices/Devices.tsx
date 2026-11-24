// The fixed devices in the editor, drawn as the canvas draws them: the keyboard (Keyboard.dc.html),
// the mouse beside it (PlayKeys.dc.html) and the Xbox controller (PlayPad.dc.html), scaled for
// editing. Each control is a button that is selected by a click and takes an action by a drop,
// the same as an Azeron button. The mouse's and the controller's controls are the rows beside the
// drawing; the drawing itself only shows which one is selected. Geometry and names are in
// ./layouts.ts, drag and drop in ./drag.ts, both pure and tested.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ControlId } from '@helmarray/core';
import { fitLabel } from '../unit/label';
import { labelStyle } from '../unit/Unit';
import { controlFor, litParts, sideOf } from './controls';
import type { DeviceProps } from './controls';
import {
  KEYBOARD_HEIGHT,
  KEYBOARD_WIDTH,
  MOUSE_ROWS,
  PAD_LEFT_ROWS,
  PAD_RIGHT_ROWS,
  fitScale,
  keyboardLayout,
} from './layouts';
import type { DeviceRow, KeyCap } from './layouts';
import { PAD_BODY, PAD_LINES } from './pad-outline';
import './devices.css';

/** What every control of these devices shares, with the drop outline's state kept here. */
function useControls(props: DeviceProps) {
  const [dropTarget, setDropTarget] = useState<ControlId | null>(null);
  return {
    dropTarget,
    props: (id: ControlId, canTake: boolean, after?: string) =>
      controlFor({ ...props, dropTarget, setDropTarget }, id, canTake, after),
  };
}

/** Fits a drawing of `natural` px to the width it is given, never past full size. */
function Fit({
  natural,
  height,
  children,
}: {
  natural: number;
  height: number;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const watch = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const scale = fitScale(width, natural);
  return (
    <div ref={host} className="dv-fit" style={{ height: `${height * scale}px` }}>
      <div style={{ width: `${natural}px`, transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}

const KEYS = keyboardLayout();

/**
 * Words a screen reader says that the eye doesn't need: inline, with no size, so the name reads
 * "R, Reload" and not "R , Reload" (a hidden block would add the space).
 */
function Said({ children }: { children: string }) {
  return children === '' ? null : <span className="dv-said">{children}</span>;
}

function KeyButton({ cap, control }: { cap: KeyCap; control: ReturnType<typeof useControls> }) {
  const { label, short, said, attrs } = control.props(cap.id, true, sideOf(cap.id));
  const width = cap.w - 16;
  const fit = label === null ? null : fitLabel(label, width, cap.h - 24, { short });
  return (
    <button
      {...attrs}
      className={`kb-k ${attrs.className}`}
      style={{ ...attrs.style, left: cap.x, top: cap.y, width: cap.w, height: cap.h }}
    >
      <span className="kb-l">
        {cap.legend}
        <Said>{fit === null ? `, not used${said}` : ', '}</Said>
      </span>
      {fit !== null && (
        <>
          <span className="kb-a" style={labelStyle(fit, width, 'left top')}>
            {fit.short ? (
              // The key label is what is seen; the action's own name is what is said.
              <>
                <span aria-hidden="true">{fit.text}</span>
                <Said>{`${label ?? ''}${said}`}</Said>
              </>
            ) : (
              <>
                {fit.text}
                <Said>{said}</Said>
              </>
            )}
          </span>
          <span className="kb-d" aria-hidden="true" />
        </>
      )}
    </button>
  );
}

/** The keyboard, 956 x 392 as the canvas has it, scaled down to fit. */
export type { DeviceProps };

export function Keyboard(props: DeviceProps) {
  const control = useControls(props);
  return (
    <Fit natural={KEYBOARD_WIDTH} height={KEYBOARD_HEIGHT}>
      <div
        role="group"
        aria-label="Keyboard"
        className="kb"
        style={{ width: KEYBOARD_WIDTH, height: KEYBOARD_HEIGHT }}
      >
        {KEYS.map((cap) => (
          <KeyButton key={cap.id} cap={cap} control={control} />
        ))}
      </div>
    </Fit>
  );
}

/** A column of controls beside a drawing: the short name in mono, the role's dot, the action. */
function Rows({
  rows,
  control,
  label,
}: {
  rows: readonly DeviceRow[];
  control: ReturnType<typeof useControls>;
  label: string;
}) {
  return (
    <div className="dv-rows" role="group" aria-label={label}>
      {rows.map((row) => {
        const { label, said, attrs } = control.props(row.id, row.stick !== true);
        return (
          <button key={row.id} {...attrs} className={`dv-r ${attrs.className}`}>
            <span className="dv-c">
              {row.code}
              <Said>, </Said>
            </span>
            <span className="dv-d" aria-hidden="true" />
            <span className="dv-a">
              {row.stick ? 'Stick' : (label ?? 'Not used')}
              <Said>{said}</Said>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The mouse, as Play view draws it, with its five buttons as rows. */
export function Mouse(props: DeviceProps) {
  const control = useControls(props);
  const lit = litParts(MOUSE_ROWS, props.selected, control.dropTarget);
  const cls = (part: string) => (lit.has(part) ? 'dv-part is-on' : 'dv-part');
  return (
    <div className="mouse">
      <svg viewBox="0 0 120 190" width="120" height="190" aria-hidden="true">
        <path
          d="M60 6C92 6 112 28 112 64V130C112 166 90 186 60 186C30 186 8 166 8 130V64C8 28 28 6 60 6Z"
          className="dv-body"
        />
        <path d="M60 6C28 6 8 28 8 64V78H60Z" className={cls('left')} />
        <path d="M60 6C92 6 112 28 112 64V78H60Z" className={cls('right')} />
        <rect x="51" y="28" width="18" height="32" rx="9" className={cls('wheel')} />
        <rect x="3" y="92" width="11" height="26" rx="4" className={cls('side1')} />
        <rect x="3" y="122" width="11" height="24" rx="4" className={cls('side2')} />
      </svg>
      <Rows rows={MOUSE_ROWS} control={control} label="Mouse" />
    </div>
  );
}

/** The Xbox controller, as Play view draws it, its buttons and sticks as rows either side. */
export function Controller(props: DeviceProps) {
  const control = useControls(props);
  const lit = litParts([...PAD_LEFT_ROWS, ...PAD_RIGHT_ROWS], props.selected, control.dropTarget);
  const cls = (part: string) => (lit.has(part) ? 'dv-part is-on' : 'dv-part');
  const circle = (part: string, cx: number, cy: number, r: number) => (
    <circle cx={cx} cy={cy} r={r} className={cls(part)} />
  );
  return (
    <div className="pad">
      <Rows rows={PAD_LEFT_ROWS} control={control} label="Controller, left side" />
      <svg viewBox="0 -52 548 430" width="100%" aria-hidden="true">
        <path
          d="M104 24C101 2 109 -34 127 -44L171 -44C187 -44 195 -26 192 8Z"
          className={`dv-trig ${cls('lt')}`}
        />
        <path
          d="M444 24C447 2 439 -34 421 -44L377 -44C361 -44 353 -26 356 8Z"
          className={`dv-trig ${cls('rt')}`}
        />
        <path d={PAD_BODY} className="dv-body-fill" />
        <path d={PAD_LINES} className="dv-lines" fillRule="evenodd" />
        <text x="148" y="-14" textAnchor="middle" className="dv-t">
          LT
        </text>
        <text x="400" y="-14" textAnchor="middle" className="dv-t">
          RT
        </text>
        <path
          d="M82 52C84 40 120 14 165 8C185 6 198 14 203 21L190 47C182 36 168 30 150 30C125 31 100 42 82 52Z"
          className={cls('lb')}
        />
        <path
          d="M466 52C464 40 428 14 383 8C363 6 350 14 345 21L358 47C366 36 380 30 398 30C423 31 448 42 466 52Z"
          className={cls('rb')}
        />
        {circle('ls', 138.5, 116, 42)}
        {circle('rs', 346.5, 199, 42)}
        {circle('dpad', 205, 204, 46)}
        {circle('y', 414.5, 81, 20)}
        {circle('x', 377, 117, 20)}
        {circle('b', 453, 118, 20)}
        {circle('a', 414.5, 153, 20)}
        {circle('view', 235, 117, 13)}
        {circle('menu', 314, 117, 13)}
      </svg>
      <Rows rows={PAD_RIGHT_ROWS} control={control} label="Controller, right side" />
    </div>
  );
}
