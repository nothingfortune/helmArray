// A fake Cyborg II for tests: it answers the session as the real units were seen to, including
// how they misbehave (reference/guides/unit-protocol.md). It stores what it is sent in the
// unit's own little-endian layout and streams it back the way a unit does. Nothing here
// touches hardware.

import type { Transport } from './session';
import { Command, PART_CAPACITY, REPORT_LENGTH, parseHostReport } from './report';

interface FakeSlot {
  name: string;
  /** Stored records by input id, in the unit's layout. */
  records: Map<number, Uint8Array>;
}

export interface FakeUnitOptions {
  firmware?: number;
  keypadType?: number;
  deviceId?: number;
  limit?: number;
  /** Slots it starts with, by number. */
  slots?: Record<number, { name: string; records?: Uint8Array[] }>;
  running?: number;
  /** Sends a button-position report nobody asked for after every this many answers. */
  chatterEvery?: number;
  /** Commands it never answers, to test what happens when an answer is lost. */
  silentOn?: readonly number[];
  /** Commands whose first answer is lost, as a dropped report would be. */
  loseFirstAnswerTo?: readonly number[];
}

const BUTTON_LENGTH = 68;
/** How the unit stores a record: page 0 is the first 53 bytes (106 for the stick). */
const PAGE0 = { button: 53, stick: 106 };
const STICK_TYPES = new Set([4, 0x15, 0x28]);

/** A written record (big-endian, OBM_COPY's layout) in the layout a unit stores. */
export function storedFromWritten(w: Uint8Array): Uint8Array {
  const at = (i: number) => w[i] ?? 0;
  const be = (i: number) => (at(i) << 8) | at(i + 1);
  const out: number[] = [];
  const le = (value: number) => out.push(value & 0xff, value >> 8);
  const [, id, pinOne, pinTwo, type] = [at(0), at(1), at(2), at(3), at(4)];
  if (STICK_TYPES.has(type)) {
    // Written: 5 upper, 7 lower, 9 angle, 11 sensitivity, 13–14 cones, 15 eight directions,
    // 16 mouse sensitivity, 17 throttle, 18 smoothing, 19 trigger, 20 combined, 21 its
    // magnitude, 22 hold trigger, 23 its magnitude, 24 hold type, 25 hold keys, 31 rotate,
    // 32 angle lock, 33–34 lock zone, 35 right, 36 invert X, 37 invert Y, 38 directions.
    out.push(2, id, pinOne, pinTwo, type, 0, 0);
    for (const i of [5, 7, 9, 11]) le(be(i));
    out.push(at(13), at(14), at(15));
    for (let i = 0; i < 48; i++) le(be(38 + i * 2));
    out.push(at(16), at(17), at(18), at(19));
    out.push(at(20) | (at(22) << 1) | (at(32) << 2) | (at(36) << 3) | (at(37) << 4));
    out.push(at(21), at(23), at(24));
    for (const i of [25, 27, 29]) le(be(i));
    out.push(at(31), at(33), at(34), at(35), 0, 0);
    return Uint8Array.from(out);
  }
  if (type === 0x23) {
    // Scroll's stored layout was never captured: the fake keeps what it was sent.
    const raw = [2, id, pinOne, pinTwo, 0x23, at(4 + 7), at(4 + 7 + 22), ...w.subarray(5)];
    return Uint8Array.from({ length: BUTTON_LENGTH }, (_, i) => raw[i] ?? 0);
  }
  // A button: tap at 4 (20 bytes), long at 24 and double at 46 (22 bytes, with a delay).
  const blocks = [4, 24, 46];
  out.push(2, id, pinOne, pinTwo, ...blocks.map((b) => at(b)));
  for (const b of blocks) for (let k = 0; k < 7; k++) le(be(b + 1 + k * 2));
  le(be(24 + 16)); // the long press's delay
  le(be(46 + 16)); // the double tap's
  out.push(blocks.reduce((bits, b, i) => bits | (at(b + 15) << i), 0));
  blocks.forEach((b, i) => {
    const tail = b + 16 + (i === 0 ? 0 : 2); // after the delay on long and double
    le(be(tail));
    out.push(at(tail + 2), at(tail + 3));
  });
  out.push(0, 0);
  return Uint8Array.from(out);
}

export class FakeUnit implements Transport {
  /** Every report the session sent, in order. */
  readonly received: Uint8Array[] = [];
  readonly slots = new Map<number, FakeSlot>();
  running: number;
  private readonly outbox: Uint8Array[] = [];
  private readonly incoming = new Map<number, number[]>();
  private stream: Uint8Array[] = [];
  private answers = 0;
  private seq = 0;
  private readonly lost = new Set<number>();

  constructor(private readonly options: FakeUnitOptions = {}) {
    for (const [slot, s] of Object.entries(options.slots ?? { 0: { name: 'Default' } })) {
      const records = new Map((s.records ?? []).map((r) => [r[1] ?? 0, r]));
      this.slots.set(Number(slot), { name: s.name, records });
    }
    this.running = options.running ?? Math.min(...this.slots.keys());
  }

  async send(report: Uint8Array): Promise<void> {
    this.received.push(report);
    const r = parseHostReport(report);
    if (this.options.silentOn?.includes(r.command)) return;
    const slotArg = r.payload[0] ?? 0;
    switch (r.command) {
      case Command.FIRMWARE_VERSION:
        return this.answer(r.command, [this.options.firmware ?? 112, this.options.keypadType ?? 8]);
      case Command.KEYPAD_DETAILS: {
        const id = this.options.deviceId ?? 49229;
        return this.answer(r.command, [...Array.from({ length: 17 }, () => 0), id & 0xff, id >> 8]);
      }
      case Command.PROFILE_LIMIT:
        return this.answer(r.command, [this.options.limit ?? 6]);
      case Command.HARDWARE_PROFILE_INDEX:
        return this.answer(r.command, [this.running]);
      case Command.PROFILE_PAYLOAD_V2:
        this.stream = this.streamOf([...this.slots.keys()].sort((a, b) => a - b));
        return this.next();
      case Command.REQUEST_PROFILE:
        // Whatever slot it is asked for, a unit answers with the one it runs.
        this.stream = this.streamOf([this.running]);
        return this.next();
      case Command.PROFILE_INPUT_PIECE:
        return this.next();
      case Command.CHECK_PROFILE: {
        // Answered only for the lowest number not in use; anything else gets silence.
        let free = 0;
        while (this.slots.has(free)) free++;
        if (slotArg !== free || free >= (this.options.limit ?? 6)) return;
        this.slots.set(free, { name: '', records: new Map() });
        return this.answer(r.command, [slotArg]);
      }
      case Command.PROFILE_NAME: {
        const slot = this.slots.get(slotArg);
        if (slot)
          slot.name = String.fromCharCode(...r.payload.slice(2, 2 + (r.payload[1] ?? 0))).slice(
            0,
            19,
          );
        return this.answer(r.command, [slotArg]);
      }
      case Command.OBM_COPY: {
        // A first part starts the record afresh: a record sent again begins from part 1.
        const parts = [...(r.part === 1 ? [] : (this.incoming.get(r.length) ?? [])), ...r.payload];
        this.answer(r.command, [], r.seq); // each part, echoing the host's sequence
        if (parts.length < r.length) return void this.incoming.set(r.length, parts);
        this.incoming.delete(r.length);
        const written = Uint8Array.from(parts);
        this.slots.get(written[0] ?? -1)?.records.set(written[1] ?? 0, storedFromWritten(written));
        return;
      }
      case Command.SWITCH_PROFILE:
        if (this.slots.has(slotArg)) this.running = slotArg;
        return this.answer(r.command, [this.running]);
      case Command.DELETE_PROFILE:
        if (slotArg !== this.running) this.slots.delete(slotArg);
        return this.answer(r.command, []);
    }
  }

  async receive(): Promise<Uint8Array | null> {
    return this.outbox.shift() ?? null;
  }

  private answer(command: number, payload: number[], seq?: number) {
    if (this.options.loseFirstAnswerTo?.includes(command) && !this.lost.has(command)) {
      this.lost.add(command);
      return;
    }
    this.outbox.push(unitReport(command, seq ?? this.nextSeq(), 1, 1, payload));
    if (this.options.chatterEvery && ++this.answers % this.options.chatterEvery === 0) {
      this.outbox.unshift(unitReport(Command.BUTTON_POSITION, this.nextSeq(), 1, 1, [1, 1]));
    }
  }

  private next() {
    const report = this.stream.shift();
    if (report) this.outbox.push(report);
  }

  private nextSeq() {
    this.seq = (this.seq + 1) % 255;
    return this.seq;
  }

  /** The stream a unit sends for these slots: name, settings, then each record's pages. */
  private streamOf(slots: number[]): Uint8Array[] {
    const items: number[][][] = [];
    for (const number of slots) {
      const slot = this.slots.get(number);
      if (!slot) continue;
      const name = Array.from(slot.name, (ch) => ch.charCodeAt(0));
      items.push([[0, 0, 1, 1, 0, 0x0c, number, name.length + 1, ...name, 0]]);
      items.push([[0, 1, 1, 0, ...Array.from({ length: 32 }, () => 0)]]);
      for (const [id, record] of [...slot.records].sort(([a], [b]) => a - b)) {
        const page0Length = STICK_TYPES.has(record[4] ?? 0) ? PAGE0.stick : PAGE0.button;
        const pieces: number[][] = [];
        [record.subarray(0, page0Length), record.subarray(page0Length)].forEach((page, p) => {
          const head = [id, 2, p, id ^ 2 ^ p];
          for (let i = 0; i < page.length; i += PART_CAPACITY - 4) {
            pieces.push([...head, ...page.subarray(i, i + PART_CAPACITY - 4)]);
          }
        });
        items.push(pieces);
      }
    }
    return items.flatMap((pieces, index) =>
      pieces.map((payload) =>
        unitReport(Command.PROFILE_PAYLOAD_V2, this.nextSeq(), items.length - 1, index, payload),
      ),
    );
  }
}

function unitReport(
  command: number,
  seq: number,
  parts: number,
  part: number,
  payload: number[],
): Uint8Array {
  const report = new Uint8Array(REPORT_LENGTH);
  report.set([
    payload.length & 0xff,
    payload.length >> 8,
    command,
    seq,
    parts,
    part,
    payload.length,
  ]);
  report.set(payload, 7);
  return report;
}
