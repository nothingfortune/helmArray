import { describe, expect, it } from 'vitest';
import type { CommandName } from './report';
import {
  PART_CAPACITY,
  ProtocolError,
  REPORT_LENGTH,
  SENDABLE,
  commandName,
  fromHex,
  hostReports,
  nextSeq,
  parseUnitReport,
  toHex,
} from './report';

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i + 1);

describe('host reports', () => {
  it('put an empty query in one report', () => {
    const [report, ...rest] = hostReports('HARDWARE_PROFILE_INDEX', 0x5f, new Uint8Array());
    expect(rest).toEqual([]);
    expect(toHex(report ?? new Uint8Array()).slice(0, 14)).toBe('00000e5f010100');
    expect(report?.length).toBe(REPORT_LENGTH);
  });

  it('split an input record 57 + 11, and a stick record 57 + 57 + 20, as the app does', () => {
    expect(hostReports('OBM_COPY', 1, bytes(68)).map((r) => r[6])).toEqual([57, 11]);
    const stick = hostReports('OBM_COPY', 1, bytes(134));
    expect(stick.map((r) => [r[1], r[3], r[4], r[5], r[6]])).toEqual([
      [134, 1, 3, 1, 57],
      [134, 2, 3, 2, 57],
      [134, 3, 3, 3, 20],
    ]);
    expect(stick[1]?.[7]).toBe(PART_CAPACITY + 1);
  });

  it('count the sequence 0 to 254, never 255', () => {
    expect(nextSeq(253)).toBe(254);
    expect(nextSeq(254)).toBe(0);
    expect(hostReports('OBM_COPY', 254, bytes(68)).map((r) => r[3])).toEqual([254, 0]);
    expect(() => hostReports('CHECK_PROFILE', 255, Uint8Array.of(3))).toThrow(ProtocolError);
  });

  it('refuse a command helmArray never sends', () => {
    expect(SENDABLE).not.toContain('REQUEST_PROFILE');
    expect(() => hostReports('REQUEST_PROFILE', 0, Uint8Array.of(3))).toThrow(
      'REQUEST_PROFILE is not a command helmArray sends.',
    );
    expect(() => hostReports('JOYSTICK_POSITION' as CommandName, 0, new Uint8Array())).toThrow(
      ProtocolError,
    );
  });

  it('refuse a payload longer than any the app sent', () => {
    expect(() => hostReports('OBM_COPY', 0, bytes(256))).toThrow(ProtocolError);
    expect(hostReports('OBM_COPY', 0, bytes(255))).toHaveLength(5);
  });
});

describe('unit reports', () => {
  it('read the length, command, sequence, parts and payload', () => {
    const report = fromHex(`1a002e0965001a${'ab'.repeat(26)}${'00'.repeat(31)}`);
    expect(parseUnitReport(report)).toEqual({
      length: 26,
      command: 0x2e,
      seq: 9,
      parts: 0x65,
      part: 0,
      payload: Uint8Array.from({ length: 26 }, () => 0xab),
    });
  });

  it('read a length over 255 from both bytes', () => {
    expect(parseUnitReport(fromHex(`2c012e0101010a${'00'.repeat(57)}`)).length).toBe(300);
  });

  it('refuse a report of the wrong size, or one claiming more than it holds', () => {
    expect(() => parseUnitReport(new Uint8Array(63))).toThrow(ProtocolError);
    expect(() => parseUnitReport(fromHex(`01002e01010139${'00'.repeat(57)}`))).not.toThrow();
    expect(() => parseUnitReport(fromHex(`01002e0101013a${'00'.repeat(57)}`))).toThrow(
      ProtocolError,
    );
  });

  it('name a command for the log, or show its byte', () => {
    expect(commandName(0x0b)).toBe('OBM_COPY');
    expect(commandName(0x12)).toBe('0x12');
  });
});
