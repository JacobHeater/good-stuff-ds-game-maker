import type { ProjectSnapshot } from "@goodstuff/core";

import type { DsScene2D, DsScene3D } from "./ds-scene";
import type { BuildOptions, RomBuilder, RomBuildResult } from "./build/rom-builder";
import { hasErrors, type Diagnostic } from "./diagnostics";
import { translateScene2D } from "./translate-scene-2d";
import type { TranslateOptions } from "./translate-scene-3d";
import { translateProject3D } from "./translate-project";

/** Everything a compile can end as. Diagnostics (errors and warnings) are always included. */
export type CompileResult =
  | ({ diagnostics: Diagnostic[] } & Extract<RomBuildResult, { ok: true }>)
  | ({ diagnostics: Diagnostic[] } & Extract<RomBuildResult, { ok: false }>)
  | { ok: false; reason: "diagnostics"; message: string; diagnostics: Diagnostic[] };

/** What the compiler has to say about a project (2D or 3D), without building anything. An error means no ROM can be built. */
export function checkProject(project: ProjectSnapshot, options: TranslateOptions = {}): Diagnostic[] {
  return (project.mode === "2D" ? translateScene2D(project, options) : translateProject3D(project, options)).diagnostics;
}

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
  const translated: { scene?: DsScene2D | null; scenes?: DsScene3D[] | null; diagnostics: Diagnostic[] } =
    project.mode === "2D" ? translateScene2D(project, options) : translateProject3D(project, options);
  const { diagnostics } = translated;
  if (!(project.mode === "2D" ? translated.scene : translated.scenes) || hasErrors(diagnostics)) {
    const errors = diagnostics.filter((d) => d.severity === "error");
    return {
      ok: false,
      reason: "diagnostics",
      message: errors.length === 1 ? errors[0].message : `${errors.length} problems stop this project from compiling.`,
      diagnostics
    };
  }
  const result =
    project.mode === "2D"
      ? await builder.build2D(translated.scene as DsScene2D, outputPath, options)
      : await builder.buildScenes(translated.scenes as DsScene3D[], outputPath, options);
  return { ...result, diagnostics };
}
