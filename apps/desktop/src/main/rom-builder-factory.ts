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

/** The one place the compiler's Node-backed pieces are composed for this app (Export ROM and Play both use it). */
export function createRomBuilder(): RomBuilder {
  return new RomBuilder({
    locator: new NodeToolchainLocator(),
    runner: new NodeBuildRunner(),
    fs: new NodeBuildFileSystem(),
    runtimeDir: runtimeDirectory()
  });
}
