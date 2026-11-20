import { describe, expect, it, vi } from 'vitest';
import { FakeUnit, UnitError, UnitSession } from '@helmarray/azeron';
import { AZERON_OPEN_SENTENCE, gatedSession, isGateRefusal } from './gated-session';
import type { UnitOps } from './gated-session';

/** A session over a fake unit that says, in order, what happened: looks and reports sent. */
async function bench(look: () => Promise<boolean>, stale = vi.fn()) {
  const unit = new FakeUnit({
    deviceId: 49229,
    slots: { 0: { name: 'Default' }, 2: { name: 'X' } },
  });
  const events: string[] = [];
  const raw = new UnitSession({
    send: (report) => {
      events.push('send');
      return unit.send(report);
    },
    receive: () => unit.receive(),
  });
  // Known to the session beforehand, so write, switch and delete would get as far as the unit.
  await raw.identify();
  await raw.readSlots();
  events.length = 0;
  const session = gatedSession(raw, {
    look: () => {
      events.push('look');
      return look();
    },
    stale,
  });
  return { session, events, stale, sent: () => events.filter((e) => e === 'send').length };
}

const OPERATIONS: [string, (s: UnitOps) => Promise<unknown>][] = [
  ['identify', (s) => s.identify()],
  ['readSlots', (s) => s.readSlots()],
  ['runningSlot', (s) => s.runningSlot()],
  ['write', (s) => s.write(1, 'Main', [], 49229)],
  ['switchTo', (s) => s.switchTo(2)],
  ['deleteSlot', (s) => s.deleteSlot(2)],
];

describe('the gated session', () => {
  describe.each(OPERATIONS)('%s', (_name, run) => {
    it('looks for the Azeron app before the first report, afresh', async () => {
      const b = await bench(() => Promise.resolve(false));
      await run(b.session).catch(() => undefined); // what the unit makes of it is not the point
      expect(b.events[0]).toBe('look');
      expect(b.events.indexOf('send')).toBeGreaterThan(0);
      expect(b.stale).not.toHaveBeenCalled();
    });

    it('is refused, with the plain sentence and nothing sent, when the app is open', async () => {
      const b = await bench(() => Promise.resolve(true));
      const refused = await run(b.session).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(refused).toBeInstanceOf(UnitError);
      expect(refused).toMatchObject({ kind: 'refused', message: AZERON_OPEN_SENTENCE });
      expect(b.sent()).toBe(0);
      expect(b.stale).toHaveBeenCalledTimes(1);
    });

    it('is refused when the look fails: anything but a plain no is a yes', async () => {
      const b = await bench(() => Promise.reject(new Error('tasklist failed')));
      await expect(run(b.session)).rejects.toMatchObject({
        kind: 'refused',
        message: AZERON_OPEN_SENTENCE,
      });
      expect(b.sent()).toBe(0);
      expect(b.stale).toHaveBeenCalledTimes(1);
    });
  });

  it('sends nothing after identify answers when the app opened while it was in flight', async () => {
    let open = false;
    const unit = new FakeUnit({ deviceId: 49229 });
    let reports = 0;
    const raw = new UnitSession({
      send: (report) => {
        reports++;
        open = true; // the Azeron app opens the moment identify's first report goes out
        return unit.send(report);
      },
      receive: () => unit.receive(),
    });
    const stale = vi.fn();
    const session = gatedSession(raw, { look: () => Promise.resolve(open), stale });
    await session.identify(); // looked before it started: fine, and it runs to its end
    const afterIdentify = reports;
    expect(afterIdentify).toBeGreaterThan(0);
    await expect(session.readSlots()).rejects.toMatchObject({ kind: 'refused' });
    await expect(session.runningSlot()).rejects.toMatchObject({ kind: 'refused' });
    expect(reports).toBe(afterIdentify);
    expect(stale).toHaveBeenCalledTimes(2);
  });

  it('works again once the app is closed: a refusal is not remembered', async () => {
    let open = true;
    const b = await bench(() => Promise.resolve(open));
    await expect(b.session.runningSlot()).rejects.toThrow(AZERON_OPEN_SENTENCE);
    open = false;
    expect(await b.session.runningSlot()).toBe(0);
  });

  it('still refuses when marking the unit stale throws', async () => {
    const b = await bench(
      () => Promise.resolve(true),
      vi.fn(() => {
        throw new Error('boom');
      }),
    );
    await expect(b.session.readSlots()).rejects.toMatchObject({ message: AZERON_OPEN_SENTENCE });
  });

  it('runs operations one at a time, each look right before its own operation', async () => {
    const b = await bench(() => Promise.resolve(false));
    await Promise.all([b.session.runningSlot(), b.session.runningSlot()]);
    const first = b.events.indexOf('look');
    const second = b.events.indexOf('look', first + 1);
    // Everything the first operation sent is before the second look.
    expect(b.events.slice(first + 1, second).every((e) => e === 'send')).toBe(true);
    expect(b.events.slice(first + 1, second).length).toBeGreaterThan(0);
  });

  it('tells its own refusal from a unit that refused', () => {
    expect(isGateRefusal(new UnitError('refused', AZERON_OPEN_SENTENCE))).toBe(true);
    expect(isGateRefusal(new UnitError('refused', 'not this unit'))).toBe(false);
    expect(isGateRefusal(new Error(AZERON_OPEN_SENTENCE))).toBe(false);
  });
});
