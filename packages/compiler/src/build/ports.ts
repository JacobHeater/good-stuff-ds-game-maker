/**
 * The three things the ROM build needs from the outside world, as small separate ports (the same
 * shape as `@goodstuff/persistence`): finding the toolchain, running a process, and touching the
 * file system. `RomBuilder` depends only on these, so every one of its behaviors, including each
 * failure, is testable with fakes and no devkitPro installed.
 */

/** A located DS toolchain. */
export interface Toolchain {
  /** Windows path of the `bash.exe` that runs builds. Builds run in that MSYS2 environment. */
  bashPath: string;
  /** Where devkitPro is, as a Windows path (for reporting). */
  devkitProDir: string;
}

export type ToolchainLookup =
  | { found: true; toolchain: Toolchain }
  | { found: false; /** Every location that was looked in. */ searched: string[]; message: string };

/**
 * Finds an installed toolchain. Implementations report what they searched when nothing is found,
 * never throw for "not installed".
 */
export interface ToolchainLocator {
  locate(): Promise<ToolchainLookup>;
}

export interface BuildCommand {
  executable: string;
  args: string[];
}

export interface BuildOutput {
  /** The process's exit code; -1 if it could not be started at all. */
  exitCode: number;
  /** Everything it printed (stdout and stderr, interleaved), capped to its most recent output. */
  output: string;
}

/** Runs one command to completion. */
export interface BuildRunner {
  run(command: BuildCommand, onOutput?: (chunk: string) => void): Promise<BuildOutput>;
}

/** The file operations a build needs. Throws on failure; `RomBuilder` turns that into a typed result. */
export interface BuildFileSystem {
  makeTempDir(prefix: string): Promise<string>;
  copyDir(from: string, to: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}
