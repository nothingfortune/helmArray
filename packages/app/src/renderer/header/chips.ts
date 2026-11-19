import type { AppState, DeviceChip } from '../../shared/api';

export type Tone = 'ok' | 'warning' | 'error';

export interface ChipView {
  /** Stable across renders: a unit's id, else its place in the row. */
  key: string;
  label: string;
  /** Spoken as well as shown, so the state is never only a colour. */
  statusWord: string;
  tone: Tone;
  /** Why it failed, in the unit's own sentence; null when there is nothing to explain. */
  tooltip: string | null;
}

const LABEL: Record<DeviceChip['hand'], string> = {
  left: 'Left',
  right: 'Right',
  unknown: 'Azeron',
};

const TONE: Record<DeviceChip['state'], Tone> = {
  ready: 'ok',
  connecting: 'warning',
  failed: 'error',
};

const WORD: Record<DeviceChip['state'], string> = {
  ready: 'ready',
  connecting: 'connecting',
  failed: 'failed',
};

const FALLBACK_ERROR = 'This unit did not answer.';

export function chipView(chip: DeviceChip, index: number): ChipView {
  return {
    key: chip.unitId === null ? `slot-${index}` : `unit-${chip.unitId}`,
    label: LABEL[chip.hand],
    statusWord: WORD[chip.state],
    tone: TONE[chip.state],
    tooltip: chip.state === 'failed' ? (chip.error ?? FALLBACK_ERROR) : null,
  };
}

/** The chips to draw, in the order the main process sent them. A unit not plugged in has none. */
export function chipViews(devices: AppState['devices']): ChipView[] {
  return devices.map(chipView);
}
