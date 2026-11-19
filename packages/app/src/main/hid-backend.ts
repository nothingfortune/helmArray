// The real node-hid behind `HidBackend`. Tests never import this file: it loads the native
// module, which they must not. Only the calls the transport needs are exposed; node-hid's
// feature-report and GET_REPORT methods are left out on purpose.

import type * as NodeHidModule from 'node-hid';
import type { HidBackend } from './hid-transport';

type NodeHid = typeof NodeHidModule;

/** Loads node-hid on first use, so building the backend touches nothing. */
export function nodeHidBackend(): HidBackend {
  let loading: Promise<NodeHid> | undefined;
  const load = (): Promise<NodeHid> =>
    (loading ??= import('node-hid').then((m) => (m as { default?: NodeHid }).default ?? m));
  return {
    async enumerate(vendorId, productId) {
      return (await load()).devicesAsync(vendorId, productId);
    },
    async open(path) {
      const device = await (await load()).HIDAsync.open(path);
      return {
        async write(data) {
          await device.write(Buffer.from(data));
        },
        async read(timeoutMs) {
          const data = await device.read(timeoutMs);
          return data ? new Uint8Array(data) : undefined;
        },
        close: () => device.close(),
      };
    },
  };
}
