// The Cyborg II's configuration reports, as the Azeron app sends and receives them
// (reference/guides/unit-protocol.md, "Reports" and "Commands"). Only commands the app was
// seen to send, with the payloads it was seen to send, can be built.

/** Every report is 64 bytes. A host report starts with report id 0. */
export const REPORT_LENGTH = 64;
const HEADER = 7;
/** Payload bytes one report carries. */
export const PART_CAPACITY = REPORT_LENGTH - HEADER;

/** The app's command table, by the command byte of a report. Names are the app's own. */
export const Command = {
  KEYPAD_DETAILS: 0x02,
  FIRMWARE_VERSION: 0x05,
  OBM_COPY: 0x0b,
  HARDWARE_PROFILE_INDEX: 0x0e,
  PROFILE_NAME: 0x10,
  SWITCH_PROFILE: 0x1a,
  DELETE_PROFILE: 0x1c,
  CHECK_PROFILE: 0x1d,
  REQUEST_PROFILE: 0x1e,
  PROFILE_LIMIT: 0x1f,
  PROFILE_INPUT_PIECE: 0x2b,
  PROFILE_PAYLOAD_V2: 0x2e,
  RELEASED_ALL_BUTTONS: 0x34,
  DEVICE_DIAGNOSTICS: 0x35,
  JOYSTICK_POSITION: 0x37,
  BUTTON_POSITION: 0x39,
} as const;
export type CommandName = keyof typeof Command;

/**
 * The commands this app may send: each one the Azeron app was seen to send, in the shape built
 * here. Nothing else can be put on the wire. Never: RESET, DFU, UPDATE_DEVICE_ID,
 * KEYPAD_DETAILS_SAVE, REQUEST_PROFILE (it answers with the running slot whatever is asked).
 */
export const SENDABLE: readonly CommandName[] = [
  'FIRMWARE_VERSION',
  'KEYPAD_DETAILS',
  'PROFILE_LIMIT',
  'HARDWARE_PROFILE_INDEX',
  'PROFILE_PAYLOAD_V2',
  'PROFILE_INPUT_PIECE',
  'CHECK_PROFILE',
  'PROFILE_NAME',
  'OBM_COPY',
  'SWITCH_PROFILE',
  'DELETE_PROFILE',
];

export class ProtocolError extends Error {}

/** The sequence number after `seq`. The app counts 0 to 254 and wraps: it never sends 255. */
export const nextSeq = (seq: number, step = 1): number => (seq + step) % 255;

/** The longest payload the app was seen to send fits a one-byte length. */
const MAX_PAYLOAD = 0xff;

/**
 * Host reports for one command: `[0][length][command][seq][parts][part][part length][payload…]`,
 * zero padded. A payload over 57 bytes goes in parts, each with the whole length in byte 1,
 * numbered from 1, the sequence counting on by one per part.
 */
export function hostReports(name: CommandName, seq: number, payload: Uint8Array): Uint8Array[] {
  if (!SENDABLE.includes(name))
    throw new ProtocolError(`${name} is not a command helmArray sends.`);
  if (payload.length > MAX_PAYLOAD) {
    throw new ProtocolError(`A ${payload.length}-byte payload is longer than any the app sent.`);
  }
  if (!Number.isInteger(seq) || seq < 0 || seq > 254) {
    throw new ProtocolError(`Sequence ${seq} is not one the app sends.`);
  }
  const parts = Math.max(1, Math.ceil(payload.length / PART_CAPACITY));
  return Array.from({ length: parts }, (_, i) => {
    const chunk = payload.subarray(i * PART_CAPACITY, (i + 1) * PART_CAPACITY);
    const report = new Uint8Array(REPORT_LENGTH);
    report.set([0, payload.length, Command[name], nextSeq(seq, i), parts, i + 1, chunk.length]);
    report.set(chunk, HEADER);
    return report;
  });
}

/** A report from the unit. */
export interface UnitReport {
  /** The whole payload's length, from bytes 0–1. */
  length: number;
  command: number;
  seq: number;
  /** In a profile stream, the index of the stream's last item; otherwise the part count. */
  parts: number;
  /** In a profile stream, the item this report belongs to; otherwise the part number. */
  part: number;
  payload: Uint8Array;
}

/** `[length lo][length hi][command][seq][parts][part][part length][payload…]`. */
export function parseUnitReport(report: Uint8Array): UnitReport {
  if (report.length !== REPORT_LENGTH) {
    throw new ProtocolError(`A unit report is ${REPORT_LENGTH} bytes, not ${report.length}.`);
  }
  const at = (i: number) => report[i] ?? 0;
  const partLength = at(6);
  if (HEADER + partLength > REPORT_LENGTH) {
    throw new ProtocolError(`A unit report claims ${partLength} bytes it doesn't have.`);
  }
  return {
    length: at(0) | (at(1) << 8),
    command: at(2),
    seq: at(3),
    parts: at(4),
    part: at(5),
    payload: report.slice(HEADER, HEADER + partLength),
  };
}

/** A host report, as a fake unit reads it: `[0][length][command][seq][parts][part][part length]…`. */
export function parseHostReport(report: Uint8Array): UnitReport {
  if (report.length !== REPORT_LENGTH || report[0] !== 0) {
    throw new ProtocolError('Not a host report.');
  }
  const at = (i: number) => report[i] ?? 0;
  return {
    length: at(1),
    command: at(2),
    seq: at(3),
    parts: at(4),
    part: at(5),
    payload: report.slice(HEADER, HEADER + Math.min(at(6), PART_CAPACITY)),
  };
}

/** The name of a command byte, for logs. */
export function commandName(code: number): string {
  const found = (Object.keys(Command) as CommandName[]).find((name) => Command[name] === code);
  return found ?? `0x${code.toString(16).padStart(2, '0')}`;
}

export const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.replace(/\s+/g, '').match(/../g) ?? [], (b) => parseInt(b, 16));
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
