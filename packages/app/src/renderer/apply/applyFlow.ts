// The Apply drawer, as a reducer and a view-model: what it holds at each step, and what it says
// and allows. Pure, so the guards (Apply only when ready, never twice, never closed mid-write)
// are tested without a window.

import type { AppState, ApplyPreview, ApplyResult, ApplyUnitChange } from '../../shared/api';

export type DrawerState =
  /** `notice`: why it is looking again (the scheme changed under the drawer). */
  | { phase: 'loading'; notice?: string }
  /** The preview could not be had at all (the main process did not answer). */
  | { phase: 'unavailable'; message: string }
  | { phase: 'ready'; preview: ApplyPreview; notice?: string }
  | { phase: 'applying'; preview: ApplyPreview }
  | { phase: 'done'; preview: ApplyPreview; result: ApplyResult };

export type DrawerEvent =
  | { type: 'open' }
  | { type: 'preview'; preview: ApplyPreview }
  | { type: 'previewFailed'; message: string }
  | { type: 'apply' }
  | { type: 'applied'; result: ApplyResult }
  | { type: 'applyFailed'; message: string }
  | { type: 'retry' };

export const START: DrawerState = { phase: 'loading' };

/** Whether Apply may be pressed: the preview says ready, and nothing is running. */
export const canApply = (state: DrawerState): boolean =>
  state.phase === 'ready' && state.preview.ready && !state.preview.busy;

export function reduce(state: DrawerState, event: DrawerEvent): DrawerState {
  switch (event.type) {
    case 'open':
      return START;
    case 'preview':
      // A fresh look replaces a stale one, but never what is being written or has been shown.
      if (state.phase === 'loading' || state.phase === 'ready') {
        return {
          phase: 'ready',
          preview: event.preview,
          ...(state.notice !== undefined && { notice: state.notice }),
        };
      }
      return state.phase === 'unavailable' ? { phase: 'ready', preview: event.preview } : state;
    case 'previewFailed':
      return state.phase === 'loading' || state.phase === 'unavailable'
        ? { phase: 'unavailable', message: event.message }
        : state;
    case 'apply':
      return canApply(state) && state.phase === 'ready'
        ? { phase: 'applying', preview: state.preview }
        : state;
    case 'applied':
      if (state.phase !== 'applying') return state;
      // Refused because the scheme changed since the preview: nothing was written. Look again,
      // and say why the layout shown is not the one that was.
      if (event.result.changed === true) return { phase: 'loading', notice: event.result.message };
      return { phase: 'done', preview: state.preview, result: event.result };
    case 'applyFailed':
      return state.phase === 'applying'
        ? {
            phase: 'done',
            preview: state.preview,
            result: { ok: false, message: event.message, units: [] },
          }
        : state;
    case 'retry':
      return state.phase === 'done' && !state.result.ok ? START : state;
  }
}

/** Changes whenever the preview could read differently: the Azeron app, a unit, a hand. */
export function previewKey(state: AppState | null): string {
  if (state === null) return '';
  return JSON.stringify([
    state.writeBlock,
    state.question === null,
    state.devices.map((d) => [d.hand, d.unitId, d.state]),
  ]);
}

// ------------------------------------------------------------------------------------- view

export interface UnitLine {
  kind: 'write' | 'delete' | 'same' | 'problem';
  text: string;
}

export interface UnitSection {
  hand: 'left' | 'right';
  title: string;
  /** One short line beside the title. */
  summary: string;
  lines: UnitLine[];
}

export interface DrawerView {
  title: string;
  subtitle: string;
  /** "Reading your Azerons…" while the preview is on its way, else null. */
  loading: string | null;
  /** The preview could not be had, in one sentence, else null. */
  unavailable: string | null;
  /** Why the layout shown is not the one before (it changed since), else null. */
  notice: string | null;
  checks: { ok: boolean; text: string }[];
  sections: UnitSection[];
  /** Shown while it writes, else null. */
  progress: string | null;
  /** How it ended, once it has. */
  result: { ok: boolean; headline: string; lines: string[] } | null;
  cancel: { label: string; disabled: boolean };
  /** Amber; absent once the apply has ended well. */
  apply: { label: string; disabled: boolean } | null;
  /** The drawer may be closed (Escape, the scrim, Cancel): never while it writes. */
  closable: boolean;
}

const slotName = (slot: { slot: number; name: string }) =>
  slot.name === '' ? `Slot ${slot.slot}` : `Slot ${slot.slot} (${slot.name})`;

export function unitSection(unit: ApplyUnitChange, azeronOpen: boolean): UnitSection {
  const title = unit.hand === 'left' ? 'Left Azeron' : 'Right Azeron';
  const base = { hand: unit.hand, title };
  if (azeronOpen) {
    return { ...base, summary: 'Not looked at', lines: [] };
  }
  if (!unit.connected) return { ...base, summary: 'Not connected', lines: [] };
  const lines: UnitLine[] = [];
  if (unit.write) {
    lines.push({
      kind: 'write',
      text: unit.write.overwrites
        ? `${slotName(unit.write.overwrites)} is written over with "${unit.write.name}", then switched to.`
        : `A new slot ${unit.write.slot} ("${unit.write.name}") is written, then switched to.`,
    });
  }
  for (const gone of unit.deletes) {
    lines.push({ kind: 'delete', text: `${slotName(gone)} is deleted.` });
  }
  if (unit.problem !== null) lines.push({ kind: 'problem', text: unit.problem });
  if (!unit.write && unit.deletes.length === 0 && unit.problem === null) {
    lines.push({ kind: 'same', text: 'It already holds this layout.' });
  }
  const summary =
    unit.problem !== null
      ? "Can't be done"
      : unit.write
        ? unit.inputsChanged === 1
          ? '1 input changes'
          : `${unit.inputsChanged} inputs change`
        : unit.deletes.length > 0
          ? 'Tidy up'
          : 'No change';
  return { ...base, summary, lines };
}

export function drawerView(state: DrawerState): DrawerView {
  const closed: Pick<DrawerView, 'sections' | 'checks'> = { sections: [], checks: [] };
  const idle = { progress: null, result: null, loading: null, unavailable: null, notice: null };
  if (state.phase === 'loading') {
    return {
      title: 'Apply',
      subtitle: 'What changes',
      ...idle,
      loading: 'Reading your Azerons…',
      notice: state.notice ?? null,
      ...closed,
      cancel: { label: 'Cancel', disabled: false },
      apply: { label: 'Apply', disabled: true },
      closable: true,
    };
  }
  if (state.phase === 'unavailable') {
    return {
      title: 'Apply',
      subtitle: 'What changes',
      ...idle,
      unavailable: state.message,
      ...closed,
      cancel: { label: 'Close', disabled: false },
      apply: { label: 'Apply', disabled: true },
      closable: true,
    };
  }
  const { preview } = state;
  const head = {
    title: preview.schemeName === '' ? 'Apply' : `Apply ${preview.schemeName}`,
    subtitle: preview.gameName === '' ? 'What changes' : `${preview.gameName} · what changes`,
  };
  const sections = [preview.left, preview.right].map((u) => unitSection(u, preview.azeronOpen));
  if (state.phase === 'ready') {
    return {
      ...head,
      ...idle,
      notice: state.notice ?? null,
      checks: preview.checks,
      sections,
      cancel: { label: 'Cancel', disabled: false },
      apply: { label: 'Apply', disabled: !canApply(state) },
      closable: true,
    };
  }
  if (state.phase === 'applying') {
    return {
      ...head,
      ...idle,
      progress:
        'Writing to your Azerons, the left one first. Keep them plugged in and the Azeron app closed.',
      checks: preview.checks,
      sections,
      cancel: { label: 'Cancel', disabled: true },
      apply: { label: 'Applying…', disabled: true },
      closable: false,
    };
  }
  const { result } = state;
  return {
    ...head,
    ...idle,
    result: {
      ok: result.ok,
      headline: result.message,
      // The units' own sentences, but not the one already said as the headline.
      lines: result.units.map((u) => u.message).filter((m) => m !== result.message),
    },
    checks: [],
    sections: [],
    cancel: { label: 'Close', disabled: false },
    apply: result.ok ? null : { label: 'Try again', disabled: false },
    closable: true,
  };
}
