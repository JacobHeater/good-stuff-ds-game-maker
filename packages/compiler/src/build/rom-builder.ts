import { dirname, join } from "node:path";

import type { DsScene3D } from "../ds-scene";
import { writeSceneDataC, writeScriptCodeC } from "../scene-data-writer";
import type { BuildFileSystem, BuildRunner, ToolchainLocator } from "./ports";

/**
 * The typed outcome of a build. Callers branch on `reason`; nothing here throws for an expected
 * failure. `toolchain-missing` and `build-failed` are different problems with different fixes.
 */
export type RomBuildResult =
  | { ok: true; romPath: string; output: string }
  | { ok: false; reason: "toolchain-missing"; message: string; searched: string[] }
  | { ok: false; reason: "build-failed"; message: string; output: string; firstError?: string }
  | { ok: false; reason: "io-error"; message: string };

export interface RomBuilderDeps {
  locator: ToolchainLocator;
  runner: BuildRunner;
  fs: BuildFileSystem;
  /** The checked-in C runtime (packages/compiler/runtime). Never modified: builds work on a copy. */
  runtimeDir: string;
}

export interface BuildOptions {
  /** Called with toolchain output as it arrives. */
  onOutput?: (chunk: string) => void;
  /** Leave the temp build directory in place, for debugging. */
  keepBuildDir?: boolean;
}

/** `C:\a\b` -> `/c/a/b`, the form MSYS2 understands. Throws for a path that can't be quoted safely. */
export function toMsysPath(windowsPath: string): string {
  if (windowsPath.includes("'")) throw new Error(`Build paths can't contain a single quote: ${windowsPath}`);
  const match = /^([a-zA-Z]):[\\/](.*)$/.exec(windowsPath);
  if (!match) throw new Error(`Expected an absolute Windows path, got: ${windowsPath}`);
  return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

const ROM_NAME = "gsgame.nds";

/** What the toolchain needs that a plain login shell doesn't provide; see tools/ds-toolchain/README.md. */
function makeScript(msysBuildDir: string): string {
  return [
    "export DEVKITPRO=/opt/devkitpro",
    "export DEVKITARM=/opt/devkitpro/devkitARM",
    'export PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"',
    `cd '${msysBuildDir}'`,
    "make"
  ].join(" && ");
}

function firstErrorLine(output: string): string | undefined {
  return output.split(/\r?\n/).find((line) => /\berror\b/i.test(line))?.trim();
}

/**
 * Builds a translated scene into a `.nds`: copies the runtime into a fresh temp directory, writes the
 * scene data next to it, runs the DS toolchain, and copies the ROM out. The checked-in runtime is never
 * touched, concurrent builds don't share a directory, and the temp directory is removed afterwards.
 */
export class RomBuilder {
  constructor(private readonly deps: RomBuilderDeps) {}

  async build(scene: DsScene3D, outputPath: string, options: BuildOptions = {}): Promise<RomBuildResult> {
    const { locator, runner, fs, runtimeDir } = this.deps;

    const lookup = await locator.locate();
    if (!lookup.found) {
      return { ok: false, reason: "toolchain-missing", message: lookup.message, searched: lookup.searched };
    }

    let buildDir: string | undefined;
    try {
      buildDir = await fs.makeTempDir("gsds-build-");
      await fs.copyDir(runtimeDir, buildDir);
      await fs.writeText(join(buildDir, "source", "scene_data.c"), writeSceneDataC(scene));
      await fs.writeText(join(buildDir, "source", "script_code.c"), writeScriptCodeC(scene));

      const result = await runner.run(
        { executable: lookup.toolchain.bashPath, args: ["-l", "-c", makeScript(toMsysPath(buildDir))] },
        options.onOutput
      );
      const builtRom = join(buildDir, ROM_NAME);
      if (result.exitCode !== 0 || !(await fs.exists(builtRom))) {
        const firstError = firstErrorLine(result.output);
        return {
          ok: false,
          reason: "build-failed",
          message: firstError ?? `The DS toolchain failed (exit code ${result.exitCode}).`,
          output: result.output,
          firstError
        };
      }

      await fs.ensureDir(dirname(outputPath));
      await fs.copyFile(builtRom, outputPath);
      return { ok: true, romPath: outputPath, output: result.output };
    } catch (error) {
      return { ok: false, reason: "io-error", message: error instanceof Error ? error.message : String(error) };
    } finally {
      if (buildDir && !options.keepBuildDir) {
        try {
          await fs.remove(buildDir);
        } catch {
          /* a leftover temp directory isn't worth failing a build over */
        }
      }
    }
  }
}
