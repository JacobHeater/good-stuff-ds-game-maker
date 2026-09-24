import { describe, expect, it } from "vitest";

import type { BuildFileSystem } from "../build/ports";
import type { CompileResult } from "../compile-project";
import { cubeProject } from "../fixtures";
import { NodeEmulatorLocator } from "./node-emulator";
import { PlaySession } from "./play-session";
import type { EmulatorLauncher, EmulatorLocator, EmulatorLookup, EmulatorProcess } from "./ports";

class FakeProcess implements EmulatorProcess {
  stopped = false;
  private finish!: () => void;
  readonly exited = new Promise<void>((resolve) => (this.finish = resolve));
  constructor(readonly romPath: string) {}
  async stop(): Promise<void> {
    this.stopped = true;
    this.finish();
  }
  /** The user closing the emulator window. */
  close(): void {
    this.finish();
  }
}

class FakeLauncher implements EmulatorLauncher {
  launched: FakeProcess[] = [];
  fail?: string;
  launch(_exe: string, romPath: string): EmulatorProcess {
    if (this.fail) throw new Error(this.fail);
    const process = new FakeProcess(romPath);
    this.launched.push(process);
    return process;
  }
}

class FakeFs implements BuildFileSystem {
  removed: string[] = [];
  dirs: string[] = [];
  async makeTempDir(): Promise<string> {
    return "";
  }
  async copyDir(): Promise<void> {}
  async writeText(): Promise<void> {}
  async copyFile(): Promise<void> {}
  async ensureDir(path: string): Promise<void> {
    this.dirs.push(path);
  }
  async exists(): Promise<boolean> {
    return true;
  }
  async remove(path: string): Promise<void> {
    this.removed.push(path);
  }
}

const okResult = (romPath: string): CompileResult => ({ ok: true, romPath, output: "", diagnostics: [] });
const found: EmulatorLookup = { found: true, executablePath: "C:\\melonDS\\melonDS.exe", description: "melonDS" };
const notFound: EmulatorLookup = { found: false, searched: ["C:\\x"], message: "No DS emulator found (looked for melonDS)." };

function setup(options: { lookup?: EmulatorLookup; compile?: (rom: string) => CompileResult | Promise<CompileResult> } = {}) {
  const launcher = new FakeLauncher();
  const fs = new FakeFs();
  const compiled: string[] = [];
  const locator: EmulatorLocator = { locate: async () => options.lookup ?? found };
  const session = new PlaySession({
    compile: async (_project, rom) => {
      compiled.push(rom);
      return (options.compile ?? okResult)(rom);
    },
    locator,
    launcher,
    fs,
    romDirectory: "C:\\tmp\\gsds-play"
  });
  return { session, launcher, fs, compiled };
}

describe("PlaySession", () => {
  it("builds the project and launches the emulator with the ROM", async () => {
    const { session, launcher, compiled, fs } = setup();
    const result = await session.play(cubeProject());
    expect(result.outcome).toBe("ok");
    expect(fs.dirs).toEqual(["C:\\tmp\\gsds-play"]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0]).toMatch(/^C:\\tmp\\gsds-play\\play-.*\.nds$/);
    expect(launcher.launched.map((p) => p.romPath)).toEqual(compiled);
    expect(result.lines.at(-1)).toBe("Running in melonDS.");
  });

  it("launches nothing when the build fails, and says why", async () => {
    const { session, launcher } = setup({
      compile: () => ({
        ok: false,
        reason: "diagnostics",
        message: "no camera",
        diagnostics: [{ severity: "error", code: "no-camera", message: "The scene has no Camera3D." }]
      })
    });
    const result = await session.play(cubeProject());
    expect(result.outcome).toBe("error");
    expect(launcher.launched).toHaveLength(0);
    expect(result.lines).toEqual(["Error: The scene has no Camera3D.", "Play stopped: the project has errors, so no ROM was built."]);
  });

  it("explains a missing emulator and keeps the built ROM", async () => {
    const { session, launcher, fs } = setup({ lookup: notFound });
    const result = await session.play(cubeProject());
    expect(result.outcome).toBe("error");
    expect(launcher.launched).toHaveLength(0);
    expect(result.lines.at(-1)).toContain("No DS emulator found");
    expect(result.lines.at(-1)).toContain(result.romPath!);
    expect(fs.removed).toEqual([]);
  });

  it("reports an emulator that can't be started, and keeps the ROM", async () => {
    const { session, launcher } = setup();
    launcher.fail = "spawn EACCES";
    const result = await session.play(cubeProject());
    expect(result.outcome).toBe("error");
    expect(result.lines.at(-1)).toContain("spawn EACCES");
    expect(result.lines.at(-1)).toContain(result.romPath!);
  });

  it("replaces the previous run: closes the old emulator, deletes its ROM, opens the new one", async () => {
    const { session, launcher, fs } = setup();
    const first = await session.play(cubeProject());
    const second = await session.play(cubeProject());
    expect(launcher.launched).toHaveLength(2);
    expect(launcher.launched[0].stopped).toBe(true);
    expect(launcher.launched[1].stopped).toBe(false);
    expect(fs.removed).toEqual([first.romPath]);
    expect(second.romPath).not.toBe(first.romPath);
  });

  it("leaves the running game alone when the next build fails", async () => {
    let fail = false;
    const { session, launcher } = setup({
      compile: (rom) => (fail ? { ok: false, reason: "build-failed", message: "boom", output: "", diagnostics: [] } : okResult(rom))
    });
    await session.play(cubeProject());
    fail = true;
    await session.play(cubeProject());
    expect(launcher.launched).toHaveLength(1);
    expect(launcher.launched[0].stopped).toBe(false);
  });

  it("doesn't try to close an emulator the user already closed", async () => {
    const { session, launcher, fs } = setup();
    await session.play(cubeProject());
    launcher.launched[0].close();
    await Promise.resolve();
    await session.play(cubeProject());
    expect(launcher.launched[0].stopped).toBe(false);
    expect(fs.removed).toEqual([]);
  });

  it("refuses a second Play while a build is running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { session, launcher } = setup({
      compile: async (rom) => {
        await gate;
        return okResult(rom);
      }
    });
    const first = session.play(cubeProject());
    await Promise.resolve();
    await Promise.resolve();
    expect(session.isBuilding).toBe(true);
    const second = await session.play(cubeProject());
    expect(second.outcome).toBe("error");
    expect(second.lines[0]).toContain("already running");
    release();
    expect((await first).outcome).toBe("ok");
    expect(launcher.launched).toHaveLength(1);
    expect(session.isBuilding).toBe(false);
  });

  it("stop() closes the running emulator", async () => {
    const { session, launcher } = setup();
    await session.play(cubeProject());
    await session.stop();
    expect(launcher.launched[0].stopped).toBe(true);
    await session.stop(); // nothing left: fine
  });
});

describe("NodeEmulatorLocator", () => {
  const winget = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages";
  const make = (env: Record<string, string>, files: string[], dirs: Record<string, string[]> = {}) =>
    new NodeEmulatorLocator({ env, exists: async (p) => files.includes(p), listDirectory: async (p) => dirs[p] ?? [] });

  it("prefers an explicit GSDS_MELONDS_PATH", async () => {
    const locator = make({ GSDS_MELONDS_PATH: "D:\\emu\\melonDS.exe", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, ["D:\\emu\\melonDS.exe"]);
    expect(await locator.locate()).toMatchObject({ found: true, executablePath: "D:\\emu\\melonDS.exe" });
  });

  it("reports a wrong GSDS_MELONDS_PATH instead of quietly using another install", async () => {
    const locator = make(
      { GSDS_MELONDS_PATH: "D:\\nope.exe", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
      [`${winget}\\melonDS.melonDS_x\\melonDS.exe`],
      { [winget]: ["melonDS.melonDS_x"] }
    );
    const result = await locator.locate();
    expect(result.found).toBe(false);
    if (!result.found) expect(result.message).toContain("D:\\nope.exe");
  });

  it("finds the winget install", async () => {
    const exe = `${winget}\\melonDS.melonDS_Microsoft.Winget.Source_8wekyb3d8bbwe\\melonDS.exe`;
    const locator = make({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, [exe], {
      [winget]: ["Other.Thing", "melonDS.melonDS_Microsoft.Winget.Source_8wekyb3d8bbwe"]
    });
    expect(await locator.locate()).toMatchObject({ found: true, executablePath: exe });
  });

  it("finds Program Files, and says what it searched and how to install when there's nothing", async () => {
    expect(await make({ ProgramFiles: "C:\\Program Files" }, ["C:\\Program Files\\melonDS\\melonDS.exe"]).locate()).toMatchObject({ found: true });
    const none = await make({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", ProgramFiles: "C:\\Program Files" }, []).locate();
    expect(none.found).toBe(false);
    if (!none.found) {
      expect(none.searched.length).toBeGreaterThan(1);
      expect(none.message).toContain("winget install melonDS.melonDS");
      expect(none.message).toContain("GSDS_MELONDS_PATH");
    }
  });
});
