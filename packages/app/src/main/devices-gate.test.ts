import { describe, expect, it } from 'vitest';
import { createDevicesGate } from './devices-gate';

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
};

/** A service that says what was done to it, with a stop that can be held open. */
function service() {
  const calls: string[] = [];
  let holdStop: Promise<void> | null = null;
  return {
    calls,
    hold(promise: Promise<void>) {
      holdStop = promise;
    },
    start: () => void calls.push('start'),
    stop: async () => {
      calls.push('stop begins');
      await holdStop;
      calls.push('stop ends');
    },
  };
}

describe('the devices gate', () => {
  it('starts nothing until the first look at the running programs', async () => {
    const devices = service();
    createDevicesGate(devices);
    await Promise.resolve();
    expect(devices.calls).toEqual([]);
  });

  it('starts the service when the Azeron app is closed', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(false);
    expect(devices.calls).toEqual(['start']);
  });

  it('never starts the service while the Azeron app is open', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(true);
    expect(devices.calls).toEqual([]);
  });

  it('stops the service, letting the units go, when the Azeron app opens', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(false);
    await gate.azeronRunning(true);
    expect(devices.calls).toEqual(['start', 'stop begins', 'stop ends']);
  });

  it('starts it again when the Azeron app closes', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(false);
    await gate.azeronRunning(true);
    await gate.azeronRunning(false);
    expect(devices.calls).toEqual(['start', 'stop begins', 'stop ends', 'start']);
  });

  it('does not start or stop twice for the same news', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(false);
    await gate.azeronRunning(false);
    await gate.azeronRunning(true);
    await gate.azeronRunning(true);
    expect(devices.calls).toEqual(['start', 'stop begins', 'stop ends']);
  });

  it('starts again only after the stop before it has let the units go', async () => {
    const devices = service();
    const held = deferred();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(false);
    devices.hold(held.promise);
    const stopping = gate.azeronRunning(true);
    const starting = gate.azeronRunning(false); // closed again before the units were let go
    await Promise.resolve();
    expect(devices.calls).toEqual(['start', 'stop begins']);
    held.release();
    await Promise.all([stopping, starting]);
    expect(devices.calls).toEqual(['start', 'stop begins', 'stop ends', 'start']);
  });

  it('settles on the last thing it was told, however fast the Azeron app flickers', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(false);
    const all = [true, false, true, false, true].map((running) => gate.azeronRunning(running));
    await Promise.all(all);
    expect(devices.calls.at(-1)).toBe('stop ends');
    expect(devices.calls.filter((c) => c === 'start').length).toBe(
      devices.calls.filter((c) => c === 'stop ends').length,
    );
  });

  it('shutdown stops a running service for good', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(false);
    await gate.shutdown();
    await gate.azeronRunning(false);
    expect(devices.calls).toEqual(['start', 'stop begins', 'stop ends']);
  });

  it('shutdown with nothing running does nothing', async () => {
    const devices = service();
    const gate = createDevicesGate(devices);
    await gate.azeronRunning(true);
    await gate.shutdown();
    expect(devices.calls).toEqual([]);
  });

  it('reports a failing stop and carries on with the next change', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const calls: string[] = [];
    const gate = createDevicesGate(
      {
        start: () => void calls.push('start'),
        stop: () => {
          calls.push('stop');
          return fail ? Promise.reject(new Error('stuck')) : Promise.resolve();
        },
      },
      (error) => errors.push(error),
    );
    await gate.azeronRunning(false);
    await gate.azeronRunning(true);
    expect(errors).toHaveLength(1);
    fail = false;
    await gate.azeronRunning(false);
    expect(calls).toEqual(['start', 'stop', 'start']);
  });
});
