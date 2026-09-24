/**
 * What running a ROM needs from the outside world, as small ports (same idea as `build/ports.ts`):
 * finding an installed emulator, and starting one. `PlaySession` depends only on these, so every
 * outcome (no emulator, a build that fails, replacing a run) is testable without an emulator.
 */

export type EmulatorLookup =
  | { found: true; executablePath: string; description: string }
  | { found: false; /** Every place that was looked in. */ searched: string[]; message: string };

/** Finds an installed emulator. Reports what it searched when there isn't one; never throws for "not installed". */
export interface EmulatorLocator {
  locate(): Promise<EmulatorLookup>;
}

/** A running emulator. */
export interface EmulatorProcess {
  /** Resolves when the emulator has exited, however that happened (closed by the user, or by `stop`). */
  readonly exited: Promise<void>;
  /** Closes the emulator and resolves once it has exited. Safe to call after it has already exited. */
  stop(): Promise<void>;
}

export interface EmulatorLauncher {
  /** Opens `romPath` in the emulator. Throws if the process can't be started. */
  launch(executablePath: string, romPath: string): EmulatorProcess;
}
