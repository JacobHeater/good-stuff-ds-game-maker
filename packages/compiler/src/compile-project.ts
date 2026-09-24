import type { ProjectSnapshot } from "@goodstuff/core";

import type { BuildOptions, RomBuilder, RomBuildResult } from "./build/rom-builder";
import { hasErrors, type Diagnostic } from "./diagnostics";
import { translateScene3D, type TranslateOptions } from "./translate-scene-3d";

/** Everything a compile can end as. Diagnostics (errors and warnings) are always included. */
export type CompileResult =
  | ({ diagnostics: Diagnostic[] } & Extract<RomBuildResult, { ok: true }>)
  | ({ diagnostics: Diagnostic[] } & Extract<RomBuildResult, { ok: false }>)
  | { ok: false; reason: "diagnostics"; message: string; diagnostics: Diagnostic[] };

/**
 * The whole compile: check the project, translate it, and build the ROM. Diagnostics come first, so a
 * project with an error never starts a build or creates a build directory.
 */
export async function compileProject(
  project: ProjectSnapshot,
  outputPath: string,
  builder: RomBuilder,
  options: TranslateOptions & BuildOptions = {}
): Promise<CompileResult> {
  const { scene, diagnostics } = translateScene3D(project, options);
  if (!scene || hasErrors(diagnostics)) {
    const errors = diagnostics.filter((d) => d.severity === "error");
    return {
      ok: false,
      reason: "diagnostics",
      message: errors.length === 1 ? errors[0].message : `${errors.length} problems stop this project from compiling.`,
      diagnostics
    };
  }
  const result = await builder.build(scene, outputPath, options);
  return { ...result, diagnostics };
}
