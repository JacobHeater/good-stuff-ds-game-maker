import { join } from "node:path";

import type { ProjectSnapshot } from "@goodstuff/core";

import type { BuildFileSystem } from "../build/ports";
import type { CompileResult } from "../compile-project";
import { describeCompileResult } from "../compile-report";
import type { EmulatorLauncher, EmulatorLocator, EmulatorProcess } from "./ports";

export interface PlayResult {
  outcome: "ok" | "error";
  /** For the Output log, in order. */
  lines: string[];
  /** The ROM that was built, when there is one (it stays on disk even if no emulator could be started). */
  romPath?: string;
}

export interface PlaySessionDeps {
  /** Compiles a project to a `.nds` at the given path (the real one is `compileProject` + a `RomBuilder`). */
  compile: (project: ProjectSnapshot, outputPath: string) => Promise<CompileResult>;
  locator: EmulatorLocator;
  launcher: EmulatorLauncher;
  fs: BuildFileSystem;
  /** A directory the session may keep ROMs in (created on demand). */
  romDirectory: string;
}

/**
 * "Play": build the project as it is now and run the ROM in an emulator, one run at a time. A new run
 * replaces the previous one, but only once the new ROM is built, so a build that fails doesn't take down
 * the game that was already running. The previous run's ROM is deleted when it's replaced; a ROM that
 * couldn't be opened (no emulator) is kept, so it can be opened by hand.
 */
export class PlaySession {
  private current: { process: EmulatorProcess; romPath: string } | undefined;
  private building = false;
  private counter = 0;

  constructor(private readonly deps: PlaySessionDeps) {}

  /** True while a build is in progress (a second Play can't start until it finishes). */
  get isBuilding(): boolean {
    return this.building;
  }

  async play(project: ProjectSnapshot): Promise<PlayResult> {
    if (this.building) return { outcome: "error", lines: ["A build is already running; wait for it to finish."] };
    this.building = true;
    try {
      const { compile, locator, launcher, fs, romDirectory } = this.deps;

      await fs.ensureDir(romDirectory);
      const romPath = join(romDirectory, `play-${Date.now()}-${++this.counter}.nds`);
      const compiled = await compile(project, romPath);
      const lines = describeCompileResult(compiled, "Play");
      if (!compiled.ok) return { outcome: "error", lines };

      const lookup = await locator.locate();
      if (!lookup.found) {
        lines.push(`${lookup.message} The ROM was built and is at "${romPath}"; you can open it in an emulator yourself.`);
        return { outcome: "error", lines, romPath };
      }

      await this.stopCurrent();
      let process: EmulatorProcess;
      try {
        process = launcher.launch(lookup.executablePath, romPath);
      } catch (error) {
        lines.push(`Could not start ${lookup.description}: ${error instanceof Error ? error.message : String(error)}. The ROM is at "${romPath}".`);
        return { outcome: "error", lines, romPath };
      }
      const run = { process, romPath };
      this.current = run;
      void process.exited.then(() => {
        if (this.current === run) this.current = undefined;
      });
      lines.push(`Running in ${lookup.description}.`);
      return { outcome: "ok", lines, romPath };
    } catch (error) {
      return { outcome: "error", lines: [`Play failed: ${error instanceof Error ? error.message : String(error)}`] };
    } finally {
      this.building = false;
    }
  }

  /** Closes the running emulator, if any (also used when the app quits). */
  async stop(): Promise<void> {
    await this.stopCurrent();
  }

  private async stopCurrent(): Promise<void> {
    const run = this.current;
    if (!run) return;
    this.current = undefined;
    await run.process.stop();
    try {
      await this.deps.fs.remove(run.romPath);
    } catch {
      /* a leftover temp ROM isn't worth failing a run over */
    }
  }
}
