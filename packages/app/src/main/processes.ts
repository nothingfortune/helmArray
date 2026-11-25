// Knows whether the Azeron app is running, so a write to a unit can be blocked with the reason in
// one sentence. Pure: the list of running programs comes in as a function (process-list.ts is
// the real one), so tests give it fake lists and fake timers.

/** An image name as compared: trimmed, in lower case, without the `.exe`. */
const imageOf = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '');

/** Whether any of `wanted` is among the running programs, in any case, with or without `.exe`. */
export function programRunning(names: readonly string[], wanted: readonly string[]): boolean {
  const images = new Set(wanted.map(imageOf));
  return names.some((name) => images.has(imageOf(name)));
}

/** `Azeron Software.exe`, in any case, with or without the `.exe`. */
export function azeronAppRunning(names: readonly string[]): boolean {
  return programRunning(names, ['Azeron Software.exe']);
}

export interface WriteBlock {
  /** Plain words for the person, one sentence. */
  reason: string;
}

/** Why a unit can't be written to right now, or null when nothing in the way is running. */
export function writeBlock(names: readonly string[]): WriteBlock | null {
  return azeronAppRunning(names)
    ? { reason: 'Close the Azeron app first: it talks to the units too.' }
    : null;
}

export interface ProcessState {
  azeronRunning: boolean;
  /** Set while writes are blocked, null when they are not. */
  block: WriteBlock | null;
}

export function processState(names: readonly string[]): ProcessState {
  return { azeronRunning: azeronAppRunning(names), block: writeBlock(names) };
}

export interface WatchDeps {
  /** Image names of the running programs. */
  listProcesses(): Promise<string[]>;
  /** The first answer, then each time the Azeron app starts or stops. */
  onChange(state: ProcessState): void;
  /** A list that couldn't be read. The last known state stands and polling goes on. */
  onError?(error: unknown): void;
}

export interface ProcessWatcher {
  /** The last state read, or null before the first list arrives. */
  current(): ProcessState | null;
  /** Reads the list now (joining a read already under way) and says what it found. */
  refresh(): Promise<ProcessState | null>;
  stop(): void;
}

/**
 * Polls the list: one read at a time, the next `intervalMs` after the last finished, so a slow
 * listing is never overlapped. A failed read is reported and the polling goes on.
 */
export function watchProcesses(deps: WatchDeps, intervalMs: number): ProcessWatcher {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: ProcessState | null = null;
  let reading: Promise<void> | null = null;

  const read = (): Promise<void> => {
    reading ??= (async () => {
      try {
        const next = processState(await deps.listProcesses());
        if (stopped) return;
        const changed = last === null || last.azeronRunning !== next.azeronRunning;
        last = next;
        if (changed) deps.onChange(next);
      } catch (error) {
        if (!stopped) deps.onError?.(error);
      } finally {
        reading = null;
      }
    })();
    return reading;
  };

  const loop = async (): Promise<void> => {
    await read();
    if (!stopped) timer = setTimeout(() => void loop(), intervalMs);
  };
  void loop();

  return {
    current: () => last,
    refresh: async () => {
      await read();
      return last;
    },
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
