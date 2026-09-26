import { app } from "electron";
import { join } from "node:path";
import { NodeBuildFileSystem, NodeBuildRunner, NodeToolchainLocator, RomBuilder } from "@goodstuff/compiler";

/**
 * Where the checked-in C runtime lives: next to the sources when running from the repo, in the app's
 * resources when packaged (electron-builder.yml copies it there).
 */
function runtimeDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "compiler-runtime")
    : join(app.getAppPath(), "..", "..", "packages", "compiler", "runtime");
}

/** The 2D runtime, beside the 3D one (electron-builder.yml copies it to `compiler-runtime-2d` when packaged). */
function runtimeDirectory2D(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "compiler-runtime-2d")
    : join(app.getAppPath(), "..", "..", "packages", "compiler", "runtime2d");
}

/** The one place the compiler's Node-backed pieces are composed for this app (Export ROM and Play both use it). */
export function createRomBuilder(): RomBuilder {
  return new RomBuilder({
    locator: new NodeToolchainLocator(),
    runner: new NodeBuildRunner(),
    fs: new NodeBuildFileSystem(),
    runtimeDir: runtimeDirectory(),
    runtimeDir2D: runtimeDirectory2D()
  });
}
