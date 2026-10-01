import { dirname, join } from "node:path";

import type { DsScene2D, DsScene3D } from "../ds-scene";
import { writeScene2DDataC, writeSceneDataC, writeSceneTableC, writeScriptCodeFileC } from "../scene-data-writer";
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
  /** The checked-in 2D runtime (packages/compiler/runtime2d). Defaults to the folder called `runtime2d` next to `runtimeDir`. */
  runtimeDir2D?: string;
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

/**
 * The most useful single line (or few) to show for a failed build. A linker failure's only line matching `error` is the
 * generic "collect2.exe: error: ld returned 1 exit status", with the actually useful "undefined reference to `symbol'"
 * lines elsewhere in the output and not containing the word "error" at all -- so those are looked for first, deduplicated
 * (the same missing symbol is often reported once per place it's called from) and preferred over the generic summary.
 */
function firstErrorLine(output: string): string | undefined {
  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const undefinedReferences = Array.from(new Set(lines.filter((line) => /undefined reference/i.test(line))));
  if (undefinedReferences.length > 0) return undefinedReferences.join(" ");
  return lines.find((line) => /\berror\b/i.test(line));
}

/**
 * Builds a translated scene into a `.nds`: copies the runtime into a fresh temp directory, writes the
 * scene data next to it, runs the DS toolchain, and copies the ROM out. The checked-in runtime is never
 * touched, concurrent builds don't share a directory, and the temp directory is removed afterwards.
 */
export class RomBuilder {
  constructor(private readonly deps: RomBuilderDeps) {}

  /** Builds a translated 3D scene (the 3D runtime and the files of a project with that one scene). */
  build(scene: DsScene3D, outputPath: string, options: BuildOptions = {}): Promise<RomBuildResult> {
    return this.buildScenes([scene], outputPath, options);
  }

  /**
   * Builds the scenes of a 3D project (the starting scene first): each scene's data is a file of its own (`scene_data.c`, `scene_data_1.c`, ...), `scene_table.c` lists them and `script_code.c`
   * holds every scene's scripts. The runtime starts in the first scene and a script's `change_scene` switches to another.
   */
  buildScenes(scenes: readonly DsScene3D[], outputPath: string, options: BuildOptions = {}): Promise<RomBuildResult> {
    const files: Record<string, string> = { "scene_table.c": writeSceneTableC(scenes.length), "script_code.c": writeScriptCodeFileC(scenes) };
    scenes.forEach((scene, index) => {
      files[index === 0 ? "scene_data.c" : `scene_data_${index}.c`] = writeSceneDataC(scene, index);
    });
    return this.buildFrom(this.deps.runtimeDir, files, outputPath, options);
  }

  /** Builds a translated 2D scene (the 2D runtime and `scene2d_data.c`). */
  build2D(scene: DsScene2D, outputPath: string, options: BuildOptions = {}): Promise<RomBuildResult> {
    const runtimeDir2D = this.deps.runtimeDir2D ?? join(dirname(this.deps.runtimeDir), "runtime2d");
    return this.buildFrom(runtimeDir2D, { "scene2d_data.c": writeScene2DDataC(scene) }, outputPath, options);
  }

  /** `sourceFiles` are written into the copy's `source` folder, by file name. */
  private async buildFrom(runtimeDir: string, sourceFiles: Record<string, string>, outputPath: string, options: BuildOptions): Promise<RomBuildResult> {
    const { locator, runner, fs } = this.deps;

    const lookup = await locator.locate();
    if (!lookup.found) {
      return { ok: false, reason: "toolchain-missing", message: lookup.message, searched: lookup.searched };
    }

    let buildDir: string | undefined;
    try {
      buildDir = await fs.makeTempDir("gsds-build-");
      await fs.copyDir(runtimeDir, buildDir);
      for (const [name, contents] of Object.entries(sourceFiles)) await fs.writeText(join(buildDir, "source", name), contents);

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
