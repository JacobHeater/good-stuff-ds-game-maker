/**
 * Command-line entry to the compiler, so it's usable and testable from a terminal independent of the
 * app. Bundled to dist/cli.mjs by `pnpm --filter @goodstuff/compiler cli:build`.
 *
 *   node dist/cli.mjs compile <project> <out.nds>
 *       Check, translate and build a project into a ROM.
 *   node dist/cli.mjs scene-data <project> <out.c>
 *       Translate a project and write only the generated scene_data.c (no toolchain needed).
 *   node dist/cli.mjs script-code <project> <out.c>
 *       The same, for the generated script_code.c.
 *
 * <project> is a .gsds file, or fixture:cube | fixture:primitives | fixture:nested | fixture:imported | fixture:textured | fixture:textured-shapes | fixture:sound.
 *
 * Exit codes: 0 success, 1 the project can't be compiled or the build failed, 2 bad usage,
 * 3 the DS toolchain isn't installed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectSnapshot } from "@goodstuff/core";

import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator } from "./build/node-adapters";
import { RomBuilder } from "./build/rom-builder";
import { compileProject } from "./compile-project";
import { formatDiagnostic, hasErrors } from "./diagnostics";
import { audioPlayerNode, cubeProject, importedModelProject, nestedProject, primitivesProject, soundProbeProject, texturedPrimitivesProject, texturedProject, toneSound } from "./fixtures";
import { writeSceneDataC, writeScriptCodeC } from "./scene-data-writer";
import { translateScene3D } from "./translate-scene-3d";

const FIXTURES: Record<string, () => ProjectSnapshot> = {
  cube: cubeProject,
  primitives: primitivesProject,
  nested: nestedProject,
  imported: importedModelProject,
  textured: texturedProject,
  "textured-shapes": texturedPrimitivesProject,
  // A looping 2-second 440 Hz tone at 22 kHz: something to listen to.
  sound: () => soundProbeProject([audioPlayerNode("Tone", { soundId: "tone", loop: true })], [toneSound("tone", { sampleRate: 22050, seconds: 2 })])
};

const USAGE = "usage: cli <compile|scene-data|script-code> <project.gsds | fixture:cube|primitives|nested|imported|textured|textured-shapes|sound> <out>";

function loadProject(source: string): ProjectSnapshot {
  if (source.startsWith("fixture:")) {
    const make = FIXTURES[source.slice("fixture:".length)];
    if (!make) throw new Error(`Unknown fixture "${source}". Known: ${Object.keys(FIXTURES).join(", ")}`);
    return make();
  }
  return JSON.parse(readFileSync(source, "utf-8")) as ProjectSnapshot;
}

async function main(argv: string[]): Promise<number> {
  const [command, source, out] = argv;
  if ((command !== "compile" && command !== "scene-data" && command !== "script-code") || !source || !out) {
    console.error(USAGE);
    return 2;
  }
  const project = loadProject(source);

  if (command === "scene-data" || command === "script-code") {
    const { scene, diagnostics } = translateScene3D(project);
    for (const d of diagnostics) console.error(formatDiagnostic(d));
    if (hasErrors(diagnostics) || !scene) return 1;
    writeFileSync(out, command === "scene-data" ? writeSceneDataC(scene) : writeScriptCodeC(scene), "utf-8");
    console.log(`wrote ${out}`);
    return 0;
  }

  // The runtime sits next to the bundled CLI (dist/cli.mjs -> ../runtime).
  const runtimeDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "runtime");
  const builder = new RomBuilder({
    locator: new NodeToolchainLocator(),
    runner: new NodeBuildRunner(),
    fs: new NodeBuildFileSystem(),
    runtimeDir
  });
  const result = await compileProject(project, resolve(out), builder, { onOutput: (chunk) => process.stderr.write(chunk) });
  for (const d of result.diagnostics) console.error(formatDiagnostic(d));

  if (result.ok) {
    console.log(`built ${result.romPath}`);
    return 0;
  }
  console.error(result.message);
  return result.reason === "toolchain-missing" ? 3 : 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
);
