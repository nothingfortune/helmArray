// Holds the app's state and keeps it right: when the units, the Azeron app or a hand changes it
// works out the new `AppState`, tells the listeners, and keeps the hand finder and the devices
// service in step. Pure: everything it touches is handed in, so tests run it over fakes.

import type { AppState, Hand } from '../shared/api';
import { composeAppState, pendingAsk } from './app-state';
import type { DevicesGate } from './devices-gate';
import type { DevicesSnapshot } from './devices';
import { createHandFinder } from './hand-finder';
import type { HandStore, HandsResult } from './hands';
import { handsFor, settleHands } from './hands';
import type { ProcessState } from './processes';

export interface CoordinatorDeps {
  devices: {
    snapshot(): DevicesSnapshot;
    onChange(listener: () => void): () => void;
  };
  hands: HandStore;
  gate: DevicesGate;
  /** The last lines of the exchange log. */
  readLog(lines: number): Promise<string[]>;
  /** The active game and scheme, read afresh each time the state is worked out. */
  active?(): { gameId: string | null; schemeId: string | null };
  trace?(unit: string, line: string): void;
}

export interface Coordinator {
  state(): AppState;
  /** Called with every new state; returns the way to stop listening. */
  onState(listener: (state: AppState) => void): () => void;
  /** The Azeron app opened or closed (or the first look at the running programs came back). */
  azeronChanged(state: ProcessState): void;
  chooseHand(unitId: number, hand: Hand): Promise<void>;
  /** The active game or scheme was changed: works out the state again and tells the listeners. */
  activeChanged(): Promise<void>;
  recentLog(lines: number): Promise<string[]>;
  /** Starts following the devices service. */
  start(): void;
  stop(): void;
}

const LOG = '(app)';
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The ids of the units that have identified themselves, in the order given. */
const idsOf = (snapshot: DevicesSnapshot): number[] =>
  snapshot.units.flatMap((unit) => (unit.identity ? [unit.identity.deviceId] : []));

export function createCoordinator(deps: CoordinatorDeps): Coordinator {
  const { devices, hands: store, gate } = deps;
  const listeners = new Set<(state: AppState) => void>();
  const trace = (line: string) => {
    try {
      deps.trace?.(LOG, line);
    } catch {
      // The log must never take the app down.
    }
  };

  /** Not known until the first look at the running programs has come back. */
  let azeronKnown = false;
  let writeBlock: string | null = null;
  let stopListening: (() => void) | null = null;
  let current = composeAppState({
    devices: devices.snapshot(),
    hands: handsFor(idsOf(devices.snapshot()), store),
    writeBlock,
    active: deps.active?.(),
  });
  let currentJson = JSON.stringify(current);
  let queue: Promise<void> = Promise.resolve();

  const finder = createHandFinder({
    // One unplug settles both units; the state is worked out once, when both are saved.
    decide: async (leftId, rightId) => {
      try {
        await store.assign(leftId, 'left');
        await store.assign(rightId, 'right');
      } finally {
        await refresh();
      }
    },
    trace: (line) => trace(`hands: ${line}`),
  });

  const blocked = () => !azeronKnown || writeBlock !== null;

  const compute = async (): Promise<void> => {
    const snapshot = devices.snapshot();
    const ids = idsOf(snapshot);
    let hands: HandsResult;
    try {
      hands = await settleHands(ids, store);
    } catch (error) {
      // A hand that couldn't be saved is still a hand for now: show it, and say why in the log.
      trace(`remembering a hand failed: ${messageOf(error)}`);
      hands = handsFor(ids, store);
    }
    // A unit unplugged for the question settles both hands: the state worked out here would
    // show the one left behind as asked about for a moment, so the next one is announced instead.
    if (finder.update(pendingAsk(snapshot, hands), blocked(), ids)) return;
    const next = composeAppState({ devices: snapshot, hands, writeBlock, active: deps.active?.() });
    const json = JSON.stringify(next);
    if (json === currentJson) return;
    current = next;
    currentJson = json;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch (error) {
        trace(`a listener threw: ${messageOf(error)}`);
      }
    }
  };

  /** One recomputation at a time, in the order asked. */
  function refresh(): Promise<void> {
    queue = queue.then(compute).catch((error: unknown) => {
      trace(`working out the state failed: ${messageOf(error)}`);
    });
    return queue;
  }

  return {
    state: () => current,
    onState: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    azeronChanged: (processes) => {
      azeronKnown = true;
      writeBlock = processes.block?.reason ?? null;
      // Units about to vanish because the service is stopped are not an unplug.
      finder.update(null, blocked(), []);
      void gate.azeronRunning(processes.azeronRunning);
      void refresh();
    },
    chooseHand: async (unitId, hand) => {
      const question = current.question;
      if (question?.kind !== 'choose' || question.unitId !== unitId) {
        throw new Error('That unit is not waiting to be told which hand it is.');
      }
      if (hand !== 'left' && hand !== 'right') throw new RangeError(`not a hand: ${String(hand)}`);
      await store.assign(unitId, hand);
      await refresh();
    },
    activeChanged: () => refresh(),
    recentLog: (lines) => deps.readLog(lines),
    start: () => {
      stopListening ??= devices.onChange(() => void refresh());
      void refresh();
    },
    stop: () => {
      stopListening?.();
      stopListening = null;
      finder.stop();
    },
  };
}
