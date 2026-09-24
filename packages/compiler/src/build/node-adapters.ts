import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BuildCommand, BuildFileSystem, BuildOutput, BuildRunner, ToolchainLocator, ToolchainLookup } from "./ports";

/** Keep only the tail of very chatty toolchain output. */
const MAX_OUTPUT_CHARS = 256 * 1024;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface NodeToolchainLocatorOptions {
  /** Defaults to `process.env`. `GSDS_MSYS2_ROOT` and `DEVKITPRO` are read from it. */
  env?: Record<string, string | undefined>;
  /** Defaults to a real file-system check. Injectable so the search order can be tested. */
  exists?: (path: string) => Promise<boolean>;
}

interface Layout {
  /** MSYS2 root; contains usr\bin\bash.exe and make.exe. */
  msysRoot: string;
  /** Windows folder that MSYS2 sees as /opt/devkitpro. */
  devkitProDir: string;
  description: string;
}

/**
 * Finds a Windows devkitPro install. There are two layouts:
 *  - devkitPro inside a standalone MSYS2 (what tools/ds-toolchain/setup-windows.ps1 makes):
 *      C:\msys64  with the toolchain at C:\msys64\opt\devkitpro
 *  - devkitPro's own installer: C:\devkitPro, with its MSYS2 at C:\devkitPro\msys2
 *
 * Note `DEVKITPRO` / `DEVKITARM` are MSYS-side paths (`/opt/devkitpro`) in the first layout, so a
 * Windows environment variable of that name is only a hint for the second one.
 */
export class NodeToolchainLocator implements ToolchainLocator {
  private readonly env: Record<string, string | undefined>;
  private readonly exists: (path: string) => Promise<boolean>;

  constructor(options: NodeToolchainLocatorOptions = {}) {
    this.env = options.env ?? process.env;
    this.exists = options.exists ?? pathExists;
  }

  async locate(): Promise<ToolchainLookup> {
    const layouts: Layout[] = [];
    const override = this.env.GSDS_MSYS2_ROOT;
    if (override) layouts.push({ msysRoot: override, devkitProDir: join(override, "opt", "devkitpro"), description: "GSDS_MSYS2_ROOT" });
    const dkp = this.env.DEVKITPRO;
    if (dkp && /^[a-zA-Z]:[\\/]/.test(dkp)) layouts.push({ msysRoot: join(dkp, "msys2"), devkitProDir: dkp, description: "DEVKITPRO" });
    layouts.push({ msysRoot: "C:\\msys64", devkitProDir: "C:\\msys64\\opt\\devkitpro", description: "MSYS2 at C:\\msys64" });
    layouts.push({ msysRoot: "C:\\devkitPro\\msys2", devkitProDir: "C:\\devkitPro", description: "devkitPro installer at C:\\devkitPro" });

    const searched: string[] = [];
    for (const layout of layouts) {
      const bash = join(layout.msysRoot, "usr", "bin", "bash.exe");
      const make = join(layout.msysRoot, "usr", "bin", "make.exe");
      const gcc = join(layout.devkitProDir, "devkitARM", "bin", "arm-none-eabi-gcc.exe");
      searched.push(layout.devkitProDir);
      if ((await this.exists(bash)) && (await this.exists(make)) && (await this.exists(gcc))) {
        return { found: true, toolchain: { bashPath: bash, devkitProDir: layout.devkitProDir } };
      }
    }
    return {
      found: false,
      searched,
      message:
        "The Nintendo DS toolchain (devkitPro) isn't installed. Run tools\\ds-toolchain\\setup-windows.ps1, " +
        "or install devkitPro with its nds-dev package and make."
    };
  }
}

/** Runs a process with Node's `child_process`, collecting its output. */
export class NodeBuildRunner implements BuildRunner {
  run(command: BuildCommand, onOutput?: (chunk: string) => void): Promise<BuildOutput> {
    return new Promise((resolve) => {
      let output = "";
      const append = (data: Buffer): void => {
        const text = data.toString("utf-8");
        output = (output + text).slice(-MAX_OUTPUT_CHARS);
        onOutput?.(text);
      };
      let child;
      try {
        child = spawn(command.executable, command.args, { windowsHide: true });
      } catch (error) {
        resolve({ exitCode: -1, output: String(error) });
        return;
      }
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error) => resolve({ exitCode: -1, output: `${output}\n${String(error)}`.trim() }));
      child.on("close", (code) => resolve({ exitCode: code ?? -1, output }));
    });
  }
}

/** The real file system. */
export class NodeBuildFileSystem implements BuildFileSystem {
  makeTempDir(prefix: string): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
  }
  async copyDir(from: string, to: string): Promise<void> {
    await cp(from, to, { recursive: true });
  }
  writeText(path: string, contents: string): Promise<void> {
    return writeFile(path, contents, "utf-8");
  }
  copyFile(from: string, to: string): Promise<void> {
    return copyFile(from, to);
  }
  async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }
  exists(path: string): Promise<boolean> {
    return pathExists(path);
  }
  remove(path: string): Promise<void> {
    return rm(path, { recursive: true, force: true });
  }
}
