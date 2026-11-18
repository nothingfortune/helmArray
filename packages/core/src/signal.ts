import type { Signal } from './model';

/** A signal as a comparable string. Two control-presses may never send the same one. */
export function signalId(signal: Signal): string {
  switch (signal.kind) {
    case 'key':
      return `key:${[...(signal.mods ?? [])].sort().join('+')}+${signal.code}`;
    case 'mouse':
      return `mouse:${signal.button}`;
    case 'scroll':
      return `scroll:${signal.dir}`;
    case 'pad':
      return `pad:${signal.control}`;
    case 'macro':
      return `macro:${signal.trigger}`;
  }
}
