// A conversation with one unit over a Transport, in the order the Azeron app was seen to hold
// it (reference/guides/unit-protocol.md, "A write" and "Deleting a slot"). The session does no
// I/O of its own: app/main gives it a Transport over node-hid, the tests a fake unit.

import type { UnitRecord } from './records';
import { encodeRecord, profileNamePayload } from './records';
import type { CommandName, UnitReport } from './report';
import {
  Command,
  ProtocolError,
  commandName,
  hostReports,
  nextSeq,
  parseUnitReport,
} from './report';
import type { StoredSlot } from './stored';
import { SlotStream } from './stored';
import type { Verdict } from './verify';
import { verify } from './verify';

export interface Transport {
  send(report: Uint8Array): Promise<void>;
  /** The next report from the unit, or null when none comes within `timeoutMs`. */
  receive(timeoutMs: number): Promise<Uint8Array | null>;
}

/** Firmware this protocol was checked against. Anything else is refused. */
export const KNOWN_FIRMWARE: readonly number[] = [111, 112];
/** The keypad type a Cyborg II reports. */
export const CYBORG2_KEYPAD_TYPE = 8;

export interface UnitIdentity {
  firmware: number;
  /** The id the Azeron app files the unit under; the only thing that tells the two apart. */
  deviceId: number;
  slotLimit: number;
  runningSlot: number;
}

export type UnitErrorKind = 'no-answer' | 'unsupported' | 'refused';

export class UnitError extends Error {
  constructor(
    readonly kind: UnitErrorKind,
    message: string,
    /** How many records of a write had gone in when it stopped. */
    readonly written = 0,
  ) {
    super(message);
    this.name = 'UnitError';
  }
}

const REPLY_MS = 1000;

export interface WriteResult extends Verdict {
  slot: number;
  written: number;
  /** The slot as read back after the write. */
  stored: StoredSlot;
  /** The slot holds another name than the one written (a unit keeps 19 characters). */
  nameDiffers: boolean;
}

export class UnitSession {
  private seq = 0;
  private slots: StoredSlot[] | null = null;
  private limit: number | null = null;

  constructor(
    private readonly transport: Transport,
    /** Every report out and in, for the log a person opens when something fails. */
    private readonly trace: (line: string) => void = () => undefined,
    /** How long to wait for an answer, however much else the unit says meanwhile. */
    private readonly replyMs = REPLY_MS,
  ) {}

  /** Who the unit is. Refuses firmware and hardware this protocol wasn't read from. */
  async identify(): Promise<UnitIdentity> {
    const version = (await this.ask('FIRMWARE_VERSION')).payload;
    const firmware = version[0] ?? 0;
    if (!KNOWN_FIRMWARE.includes(firmware)) {
      throw new UnitError(
        'unsupported',
        `This unit runs firmware ${firmware}; helmArray knows ${KNOWN_FIRMWARE.join(' and ')}.`,
      );
    }
    if (version[1] !== CYBORG2_KEYPAD_TYPE) {
      throw new UnitError('unsupported', 'This keypad is not a Cyborg II.');
    }
    const details = (await this.ask('KEYPAD_DETAILS')).payload;
    if (details.length < 19)
      throw new UnitError('unsupported', 'The unit’s details were too short to hold its id.');
    const limit = (await this.ask('PROFILE_LIMIT')).payload[0] ?? 0;
    this.limit = limit;
    return {
      firmware,
      deviceId: (details[17] ?? 0) | ((details[18] ?? 0) << 8),
      slotLimit: limit,
      runningSlot: await this.runningSlot(),
    };
  }

  /** The slot the unit runs, asked each time: the profile button moves it unannounced. */
  async runningSlot(): Promise<number> {
    const slot = (await this.ask('HARDWARE_PROFILE_INDEX')).payload[0];
    if (slot === undefined)
      throw new UnitError('refused', 'The unit didn’t say which slot it runs.');
    return slot;
  }

  /**
   * Every slot, as stored. Each piece is acknowledged before the unit sends the next, as the
   * app does. A stream that stops part way is read again, once.
   */
  async readSlots(): Promise<StoredSlot[]> {
    try {
      this.slots = await this.stream();
    } catch (error) {
      if (!(error instanceof UnitError) || error.kind !== 'no-answer') throw error;
      this.trace('the slots stopped coming part way; reading them again');
      this.slots = await this.stream();
    }
    return this.slots;
  }

  /**
   * Writes records into a slot and reads it back. A new slot must be the lowest free number:
   * CHECK_PROFILE adds it, and a unit answers that only for the lowest free one. An existing
   * slot is renamed and written over. Everything is encoded before anything is sent, so a
   * record the unit can't hold leaves the slot untouched.
   */
  async write(slot: number, name: string, records: readonly UnitRecord[]): Promise<WriteResult> {
    const encoded = records.map((record) => ({ id: record.id, bytes: encodeRecord(slot, record) }));
    const namePayload = profileNamePayload(slot, name);
    const held = this.knownSlots();
    if (this.limit === null) throw new ProtocolError('Identify the unit before writing to it.');
    const adding = !held.some((s) => s.slot === slot);
    if (adding) {
      const free = lowestFree(held, this.limit);
      if (slot !== free) {
        throw new ProtocolError(
          free === undefined
            ? `All ${this.limit} slots are in use: pick one to write over.`
            : `A new slot goes at ${free}, the lowest free number, not ${slot}.`,
        );
      }
      // Not repeated: a lost answer may mean the slot was added.
      await this.ask('CHECK_PROFILE', Uint8Array.of(slot), false);
    }
    await this.ask('PROFILE_NAME', namePayload);
    let written = 0;
    for (const record of encoded) {
      try {
        await this.sendRecord(record.bytes);
      } catch (error) {
        if (error instanceof UnitError)
          throw new UnitError(
            error.kind,
            `${error.message} Input ${record.id} of ${encoded.length} didn't go in.`,
            written,
          );
        throw error;
      }
      written++;
    }
    let slots: StoredSlot[];
    try {
      slots = await this.readSlots();
    } catch (error) {
      // Every input went in; only the check didn't happen. Say so, rather than imply nothing
      // was written.
      if (error instanceof UnitError) {
        throw new UnitError(
          error.kind,
          `All ${written} inputs were written, but reading the slot back failed: ${error.message}`,
          written,
        );
      }
      throw error;
    }
    const stored = slots.find((s) => s.slot === slot);
    if (!stored) {
      throw new UnitError(
        'refused',
        `All ${written} inputs were sent, but slot ${slot} isn't there to read back.`,
        written,
      );
    }
    return {
      slot,
      written,
      stored,
      nameDiffers: stored.name !== name,
      ...verify(records, stored.records),
    };
  }

  /** Makes the unit run a slot, and asks it which it runs to be sure. */
  async switchTo(slot: number): Promise<void> {
    if (!this.knownSlots().some((s) => s.slot === slot))
      throw new ProtocolError(`The unit has no slot ${slot}.`);
    await this.ask('SWITCH_PROFILE', Uint8Array.of(slot));
    const running = await this.runningSlot();
    if (running !== slot)
      throw new UnitError('refused', `Asked to run slot ${slot}, the unit runs ${running}.`);
  }

  /**
   * Deletes a slot the unit isn't running, and reads the slots to see it gone. The others keep
   * their numbers. The running slot and the last slot are refused.
   */
  async deleteSlot(slot: number): Promise<StoredSlot[]> {
    const held = this.knownSlots();
    if (!held.some((s) => s.slot === slot))
      throw new ProtocolError(`The unit has no slot ${slot}.`);
    if (held.length <= 1) throw new ProtocolError('That is the unit’s only slot.');
    if ((await this.runningSlot()) === slot) {
      throw new ProtocolError(`The unit is running slot ${slot}: switch away from it first.`);
    }
    try {
      // Not repeated: a lost answer may mean it was deleted, which the read below shows.
      await this.ask('DELETE_PROFILE', Uint8Array.of(slot), false);
    } catch (error) {
      if (!(error instanceof UnitError) || error.kind !== 'no-answer') throw error;
      this.trace(`no answer to deleting slot ${slot}; reading the slots to see`);
    }
    const after = await this.readSlots();
    if (after.some((s) => s.slot === slot))
      throw new UnitError('refused', `Slot ${slot} is still there after deleting it.`);
    return after;
  }

  private knownSlots(): StoredSlot[] {
    if (!this.slots) throw new ProtocolError('Read the unit’s slots first.');
    return this.slots;
  }

  private async stream(): Promise<StoredSlot[]> {
    await this.send('PROFILE_PAYLOAD_V2', new Uint8Array());
    const stream = new SlotStream();
    for (;;) {
      const done = stream.push(await this.reply(Command.PROFILE_PAYLOAD_V2));
      await this.send('PROFILE_INPUT_PIECE', new Uint8Array());
      if (done) return stream.slots();
    }
  }

  /** One record, each part answered with its own sequence number. Sent again, whole, once. */
  private async sendRecord(bytes: Uint8Array): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        const reports = hostReports('OBM_COPY', this.seq, bytes);
        this.seq = nextSeq(this.seq, reports.length);
        for (const report of reports) {
          await this.out(report);
          await this.reply(Command.OBM_COPY, report[3]);
        }
        return;
      } catch (error) {
        if (!(error instanceof UnitError) || error.kind !== 'no-answer' || attempt > 1) throw error;
        this.trace('no answer to an input record; sending it once more');
      }
    }
  }

  private async send(name: CommandName, payload: Uint8Array): Promise<void> {
    const reports = hostReports(name, this.seq, payload);
    this.seq = nextSeq(this.seq, reports.length);
    for (const report of reports) await this.out(report);
  }

  private async out(report: Uint8Array) {
    this.trace(`→ ${commandName(report[2] ?? 0)} ${hex(report)}`);
    await this.transport.send(report);
  }

  /** The unit's answer to a command (and sequence, when given), passing over the rest. */
  private async reply(command: number, seq?: number): Promise<UnitReport> {
    const deadline = Date.now() + this.replyMs;
    for (;;) {
      // Checked on every report: a unit chattering about button positions must not keep a
      // lost answer waiting forever.
      const left = deadline - Date.now();
      const raw = left > 0 ? await this.transport.receive(left) : null;
      if (raw === null)
        throw new UnitError('no-answer', `The unit didn’t answer ${commandName(command)}.`);
      let report: UnitReport;
      try {
        report = parseUnitReport(raw);
      } catch {
        this.trace(`← (unreadable, passed over) ${hex(raw)}`);
        continue;
      }
      this.trace(`← ${commandName(report.command)} ${hex(raw)}`);
      if (report.command === command && (seq === undefined || report.seq === seq)) return report;
      // Button positions, diagnostics and late answers come unasked.
    }
  }

  /** Sends a command and waits for its answer; a step safe to repeat is tried once more. */
  private async ask(
    name: CommandName,
    payload: Uint8Array = new Uint8Array(),
    repeatable = true,
  ): Promise<UnitReport> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.send(name, payload);
        return await this.reply(Command[name]);
      } catch (error) {
        if (
          !(error instanceof UnitError) ||
          error.kind !== 'no-answer' ||
          !repeatable ||
          attempt > 1
        )
          throw error;
        this.trace(`no answer to ${name}; trying once more`);
      }
    }
  }
}

/** Where a new slot goes: the lowest number the unit doesn't hold. */
export function lowestFree(held: readonly StoredSlot[], limit: number): number | undefined {
  for (let slot = 0; slot < limit; slot++) if (!held.some((s) => s.slot === slot)) return slot;
  return undefined;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes.subarray(0, 7 + Math.min(bytes[6] ?? 0, 16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
