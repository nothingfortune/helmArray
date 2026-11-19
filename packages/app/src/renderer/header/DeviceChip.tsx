import { Tooltip } from 'radix-ui';
import type { ChipView } from './chips';

/** One unit: its hand and a status dot. A failed unit says why on hover or focus. */
export function DeviceChip({ chip }: { chip: ChipView }) {
  const body = (
    <span
      className="chip"
      aria-label={`${chip.label}, ${chip.statusWord}`}
      tabIndex={chip.tooltip === null ? undefined : 0}
    >
      <span className={`dot tone-${chip.tone}`} aria-hidden="true" />
      {chip.label}
    </span>
  );
  if (chip.tooltip === null) return body;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{body}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="bottom" sideOffset={8}>
          {chip.tooltip}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
