// The rule that keeps helmArray off the units while the Azeron app runs: two programs talking to
// one unit mix their answers. The devices service runs only while the Azeron app is closed: it is
// stopped (and every unit let go) when the app opens, and started when it closes. Until the first
// look at the running programs has come back nothing is known, so nothing is started.
//
// Pure: it is handed the service. Changes are made one at a time and in order, so a start never
// begins before the stop it follows has let the units go.

export interface Switchable {
  start(): void;
  stop(): Promise<void>;
  /**
   * Stops as `stop` does, but keeps the units still plugged in, without talking to them: the
   * Azeron app is open, not the units gone. Without it the service is stopped.
   */
  pause?(): Promise<void>;
}

export interface DevicesGate {
  /** What the Azeron app is doing now. Resolves when the service has been put as it should be. */
  azeronRunning(running: boolean): Promise<void>;
  /** Stops the service for good (the app is quitting); nothing starts it again. */
  shutdown(): Promise<void>;
}

export function createDevicesGate(
  devices: Switchable,
  onError?: (error: unknown) => void,
): DevicesGate {
  let running = false; // whether the service is started
  let paused = false; // whether it is paused (only with a service that can pause)
  let done = false;
  let queue: Promise<void> = Promise.resolve();

  /** Brings the service to what one request wants. Every request is carried out, in order: a
   *  stop is never skipped because the Azeron app closed again before it was reached. */
  const settle = async (want: boolean) => {
    if (done) return;
    if (want && !running) {
      running = true;
      paused = false;
      devices.start();
    } else if (!want && devices.pause !== undefined && !paused) {
      // Also at the first look, with the Azeron app already open: the units are still listed.
      running = false;
      paused = true;
      await devices.pause();
    } else if (!want && running) {
      running = false;
      await devices.stop();
    }
  };

  const enqueue = (want: boolean): Promise<void> => {
    const result = queue.then(() => settle(want));
    queue = result.catch((error: unknown) => {
      try {
        onError?.(error);
      } catch {
        // Nothing more can be done about a log that can't say it is failing.
      }
    });
    return queue;
  };

  return {
    azeronRunning: (isRunning) => enqueue(!isRunning),
    shutdown: () => {
      done = true;
      queue = queue
        .then(async () => {
          if (running || paused) {
            running = false;
            paused = false;
            await devices.stop();
          }
        })
        .catch(() => undefined);
      return queue;
    },
  };
}
