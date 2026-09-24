import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { EmulatorLauncher, EmulatorLocator, EmulatorLookup, EmulatorProcess } from "./ports";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listDirectory(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

export interface NodeEmulatorLocatorOptions {
  /** Defaults to `process.env`. `GSDS_MELONDS_PATH`, `LOCALAPPDATA` and `ProgramFiles` are read from it. */
  env?: Record<string, string | undefined>;
  exists?: (path: string) => Promise<boolean>;
  listDirectory?: (path: string) => Promise<string[]>;
}

/**
 * Finds melonDS. In priority order: `GSDS_MELONDS_PATH` (an explicit choice always wins, and if it's
 * set but wrong that's reported rather than silently falling through to another install), then the
 * winget package folder (`winget install melonDS.melonDS`, what tools/ds-toolchain/setup-windows.ps1
 * uses), then Program Files. See requirements/run-games-locally/SPIKE.emulator-selection-and-launch.md.
 */
export class NodeEmulatorLocator implements EmulatorLocator {
  private readonly env: Record<string, string | undefined>;
  private readonly exists: (path: string) => Promise<boolean>;
  private readonly list: (path: string) => Promise<string[]>;

  constructor(options: NodeEmulatorLocatorOptions = {}) {
    this.env = options.env ?? process.env;
    this.exists = options.exists ?? pathExists;
    this.list = options.listDirectory ?? listDirectory;
  }

  async locate(): Promise<EmulatorLookup> {
    const override = this.env.GSDS_MELONDS_PATH;
    if (override) {
      if (await this.exists(override)) return { found: true, executablePath: override, description: "melonDS (GSDS_MELONDS_PATH)" };
      return {
        found: false,
        searched: [override],
        message: `GSDS_MELONDS_PATH is set to "${override}", but there's no file there. Fix the path or unset it.`
      };
    }

    const searched: string[] = [];
    const localAppData = this.env.LOCALAPPDATA;
    if (localAppData) {
      const packages = join(localAppData, "Microsoft", "WinGet", "Packages");
      searched.push(join(packages, "melonDS.melonDS_*"));
      for (const entry of await this.list(packages)) {
        if (!entry.startsWith("melonDS.melonDS")) continue;
        const candidate = join(packages, entry, "melonDS.exe");
        if (await this.exists(candidate)) return { found: true, executablePath: candidate, description: "melonDS" };
      }
    }
    for (const root of [this.env.ProgramFiles, this.env["ProgramFiles(x86)"]]) {
      if (!root) continue;
      const candidate = join(root, "melonDS", "melonDS.exe");
      searched.push(candidate);
      if (await this.exists(candidate)) return { found: true, executablePath: candidate, description: "melonDS" };
    }
    return {
      found: false,
      searched,
      message:
        "No DS emulator found (looked for melonDS). Install it with `winget install melonDS.melonDS`, " +
        "or set GSDS_MELONDS_PATH to the full path of melonDS.exe."
    };
  }
}

/** Starts the emulator as a child process with the ROM path as its only argument. */
export class NodeEmulatorLauncher implements EmulatorLauncher {
  launch(executablePath: string, romPath: string): EmulatorProcess {
    const child = spawn(executablePath, [romPath], { stdio: "ignore", windowsHide: false });
    // A failed spawn (missing file, no permission) arrives as an "error" event rather than a throw;
    // either way the process is gone, so both count as exiting.
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    return {
      exited,
      async stop(): Promise<void> {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await exited;
      }
    };
  }
}
