import { afterEach, describe, expect, it, vi } from 'vitest';
import { nodeHidBackend } from './hid-backend';

// If the guard ever failed, the real node-hid would be loaded and asked for a device list. This
// stands in for it, so reaching it fails the test instead of reaching the bus.
vi.mock('node-hid', () => ({
  default: {
    devicesAsync: () => Promise.reject(new Error('the real node-hid was reached')),
    HIDAsync: { open: () => Promise.reject(new Error('the real node-hid was reached')) },
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the real HID backend under a test run', () => {
  it('refuses to list devices', async () => {
    vi.stubEnv('HELM_E2E', '1');
    await expect(nodeHidBackend().enumerate(0x16d0, 0x12f7)).rejects.toThrow(
      'A test run never opens real HID devices.',
    );
  });

  it('refuses to open one', async () => {
    vi.stubEnv('HELM_E2E', '1');
    await expect(nodeHidBackend().open('any-path')).rejects.toThrow(
      'A test run never opens real HID devices.',
    );
  });

  it('refuses when the switch is half-set, not only when it is 1', async () => {
    vi.stubEnv('HELM_E2E', 'yes');
    await expect(nodeHidBackend().enumerate(0x16d0, 0x12f7)).rejects.toThrow('HELM_E2E must be 1');
  });
});

describe('the real HID backend in a normal run', () => {
  it('goes on to node-hid', async () => {
    vi.stubEnv('HELM_E2E', '');
    await expect(nodeHidBackend().enumerate(0x16d0, 0x12f7)).rejects.toThrow(
      'the real node-hid was reached',
    );
  });
});
