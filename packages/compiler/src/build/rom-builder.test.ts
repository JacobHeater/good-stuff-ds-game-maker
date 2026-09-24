import { describe, expect, it } from "vitest";

import { compileProject } from "../compile-project";
import { cubeProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { NodeToolchainLocator } from "./node-adapters";
import type { BuildCommand, BuildFileSystem, BuildOutput, BuildRunner, ToolchainLocator, ToolchainLookup } from "./ports";
import { RomBuilder, toMsysPath } from "./rom-builder";

/** An in-memory file system: files are a map, directories are implied by their files. */
class FakeFs implements BuildFileSystem {
  files = new Map<string, string>();
  dirs = new Set<string>();
  removed: string[] = [];
  private n = 0;
  failOn?: "copyFile";

  async makeTempDir(prefix: string): Promise<string> {
    const dir = `C:\\tmp\\${prefix}${++this.n}`;
    this.dirs.add(dir);
    return dir;
  }
  async copyDir(from: string, to: string): Promise<void> {
    this.files.set(`${to}\\Makefile`, `copied from ${from}`);
  }
  async writeText(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
  }
  async copyFile(from: string, to: string): Promise<void> {
    if (this.failOn === "copyFile") throw new Error("disk full");
    this.files.set(to, this.files.get(from) ?? "");
  }
  async ensureDir(): Promise<void> {}
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async remove(path: string): Promise<void> {
    this.removed.push(path);
    this.dirs.delete(path);
    for (const key of [...this.files.keys()]) if (key.startsWith(path)) this.files.delete(key);
  }
}

class FakeRunner implements BuildRunner {
  commands: BuildCommand[] = [];
  constructor(
    private readonly fs: FakeFs,
    private readonly behavior: { exitCode: number; output: string; produceRom: boolean }
  ) {}
  async run(command: BuildCommand, onOutput?: (chunk: string) => void): Promise<BuildOutput> {
    this.commands.push(command);
    onOutput?.(this.behavior.output);
    if (this.behavior.produceRom) {
      const dir = /cd '\/c\/tmp\/([^']+)'/.exec(command.args[2])![1];
      this.fs.files.set(`C:\\tmp\\${dir}\\gsgame.nds`, "ROM");
    }
    return { exitCode: this.behavior.exitCode, output: this.behavior.output };
  }
}

const found: ToolchainLookup = { found: true, toolchain: { bashPath: "C:\\msys64\\usr\\bin\\bash.exe", devkitProDir: "C:\\msys64\\opt\\devkitpro" } };
const missing: ToolchainLookup = { found: false, searched: ["C:\\msys64\\opt\\devkitpro"], message: "devkitPro isn't installed." };
const locatorOf = (lookup: ToolchainLookup): ToolchainLocator => ({ locate: async () => lookup });

function setup(lookup: ToolchainLookup, behavior = { exitCode: 0, output: "built ... gsgame.nds", produceRom: true }) {
  const fs = new FakeFs();
  const runner = new FakeRunner(fs, behavior);
  const builder = new RomBuilder({ locator: locatorOf(lookup), runner, fs, runtimeDir: "C:\\repo\\runtime" });
  return { fs, runner, builder };
}
const scene = translateScene3D(cubeProject()).scene!;

describe("toMsysPath", () => {
  it("converts drive paths to the /c/... form MSYS2 understands", () => {
    expect(toMsysPath("C:\\Users\\me\\AppData\\Local\\Temp\\b1")).toBe("/c/Users/me/AppData/Local/Temp/b1");
    expect(toMsysPath("D:/x/y")).toBe("/d/x/y");
  });
  it("refuses what it can't quote safely, or can't convert", () => {
    expect(() => toMsysPath("C:\\it's\\here")).toThrow();
    expect(() => toMsysPath("relative\\path")).toThrow();
  });
});

describe("RomBuilder", () => {
  it("builds a ROM: copies the runtime, writes scene data, runs make, copies the .nds out", async () => {
    const { fs, runner, builder } = setup(found);
    const result = await builder.build(scene, "C:\\out\\game.nds", { keepBuildDir: true }); // keep it, to inspect it below
    expect(result).toMatchObject({ ok: true, romPath: "C:\\out\\game.nds" });
    expect(fs.files.get("C:\\out\\game.nds")).toBe("ROM");
    const dir = "C:\\tmp\\gsds-build-1";
    expect(fs.files.get(`${dir}\\Makefile`)).toContain("C:\\repo\\runtime");
    expect(fs.files.get(`${dir}\\source\\scene_data.c`)).toContain("const GsScene gs_scene");
    expect(runner.commands).toHaveLength(1);
    expect(runner.commands[0].executable).toBe("C:\\msys64\\usr\\bin\\bash.exe");
    const script = runner.commands[0].args[2];
    expect(script).toContain("export DEVKITPRO=/opt/devkitpro");
    expect(script).toContain('export PATH="$DEVKITARM/bin:$DEVKITPRO/tools/bin:$PATH"'); // devkit-env.sh doesn't do this
    expect(script).toContain("cd '/c/tmp/gsds-build-1' && make");
  });

  it("cleans up its temp directory, on success and failure alike", async () => {
    const ok = setup(found);
    await ok.builder.build(scene, "C:\\out\\a.nds");
    expect(ok.fs.removed).toEqual(["C:\\tmp\\gsds-build-1"]);
    const bad = setup(found, { exitCode: 2, output: "boom", produceRom: false });
    await bad.builder.build(scene, "C:\\out\\b.nds");
    expect(bad.fs.removed).toEqual(["C:\\tmp\\gsds-build-1"]);
  });

  it("can keep the build directory for debugging", async () => {
    const { fs, builder } = setup(found);
    await builder.build(scene, "C:\\out\\a.nds", { keepBuildDir: true });
    expect(fs.removed).toEqual([]);
  });

  it("reports a missing toolchain as such, says what was searched, and creates nothing", async () => {
    const { fs, runner, builder } = setup(missing);
    const result = await builder.build(scene, "C:\\out\\a.nds");
    expect(result).toEqual({ ok: false, reason: "toolchain-missing", message: "devkitPro isn't installed.", searched: ["C:\\msys64\\opt\\devkitpro"] });
    expect(fs.dirs.size).toBe(0);
    expect(fs.files.size).toBe(0);
    expect(runner.commands).toHaveLength(0);
  });

  it("reports a toolchain error with its output and the first error line", async () => {
    const output = "main.c\nsource/scene_data.c:4:1: error: unknown type name 'GsScene'\nmake: *** [Makefile:1] Error 1";
    const { builder } = setup(found, { exitCode: 2, output, produceRom: false });
    const result = await builder.build(scene, "C:\\out\\a.nds");
    expect(result).toMatchObject({ ok: false, reason: "build-failed", output, firstError: "source/scene_data.c:4:1: error: unknown type name 'GsScene'" });
    if (!result.ok && result.reason === "build-failed") expect(result.message).toBe(result.firstError);
  });

  it("treats a zero exit with no ROM as a failed build, not a success", async () => {
    const { builder } = setup(found, { exitCode: 0, output: "done", produceRom: false });
    expect(await builder.build(scene, "C:\\out\\a.nds")).toMatchObject({ ok: false, reason: "build-failed" });
  });

  it("reports a file-system failure as an io-error, still cleaning up", async () => {
    const { fs, builder } = setup(found);
    fs.failOn = "copyFile";
    const result = await builder.build(scene, "C:\\out\\a.nds");
    expect(result).toEqual({ ok: false, reason: "io-error", message: "disk full" });
    expect(fs.removed).toEqual(["C:\\tmp\\gsds-build-1"]);
  });

  it("gives concurrent builds their own directories", async () => {
    const { fs, builder } = setup(found);
    await Promise.all([builder.build(scene, "C:\\out\\a.nds", { keepBuildDir: true }), builder.build(scene, "C:\\out\\b.nds", { keepBuildDir: true })]);
    expect([...fs.dirs].sort()).toEqual(["C:\\tmp\\gsds-build-1", "C:\\tmp\\gsds-build-2"]);
  });

  it("streams toolchain output as it arrives", async () => {
    const { builder } = setup(found);
    const chunks: string[] = [];
    await builder.build(scene, "C:\\out\\a.nds", { onOutput: (c) => chunks.push(c) });
    expect(chunks.join("")).toContain("gsgame.nds");
  });
});

describe("compileProject: diagnostics come before any build", () => {
  it("a project with an error never reaches the toolchain or creates a directory", async () => {
    const { fs, runner, builder } = setup(found);
    const project = cubeProject();
    project.scene.children = project.scene.children.filter((c) => c.kind !== "Camera3D");
    const result = await compileProject(project, "C:\\out\\a.nds", builder);
    expect(result).toMatchObject({ ok: false, reason: "diagnostics", message: "The scene needs a Camera3D." });
    expect(runner.commands).toHaveLength(0);
    expect(fs.dirs.size).toBe(0);
  });

  it("a warning does not stop the build and is returned with the result", async () => {
    const { builder } = setup(found);
    const project = cubeProject();
    project.scene.children.push({ ...project.scene.children[2], id: "omni", name: "Lamp", kind: "OmniLight3D" });
    const result = await compileProject(project, "C:\\out\\a.nds", builder);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "omni-light-skipped", nodeName: "Lamp" })]);
  });

  it("a missing toolchain is reported as such, with the diagnostics still attached", async () => {
    const { builder } = setup(missing);
    const result = await compileProject(cubeProject(), "C:\\out\\a.nds", builder);
    expect(result).toMatchObject({ ok: false, reason: "toolchain-missing", diagnostics: [] });
  });
});

describe("NodeToolchainLocator search order", () => {
  const present = (paths: string[]) => async (p: string): Promise<boolean> => paths.includes(p);
  const layoutA = ["C:\\msys64\\usr\\bin\\bash.exe", "C:\\msys64\\usr\\bin\\make.exe", "C:\\msys64\\opt\\devkitpro\\devkitARM\\bin\\arm-none-eabi-gcc.exe"];
  const layoutB = ["C:\\devkitPro\\msys2\\usr\\bin\\bash.exe", "C:\\devkitPro\\msys2\\usr\\bin\\make.exe", "C:\\devkitPro\\devkitARM\\bin\\arm-none-eabi-gcc.exe"];

  it("finds devkitPro inside a standalone MSYS2", async () => {
    const r = await new NodeToolchainLocator({ env: {}, exists: present(layoutA) }).locate();
    expect(r).toEqual({ found: true, toolchain: { bashPath: "C:\\msys64\\usr\\bin\\bash.exe", devkitProDir: "C:\\msys64\\opt\\devkitpro" } });
  });

  it("finds the devkitPro installer's own layout", async () => {
    const r = await new NodeToolchainLocator({ env: {}, exists: present(layoutB) }).locate();
    expect(r).toMatchObject({ found: true, toolchain: { devkitProDir: "C:\\devkitPro" } });
  });

  it("honors GSDS_MSYS2_ROOT before the defaults", async () => {
    const custom = ["D:\\tools\\msys\\usr\\bin\\bash.exe", "D:\\tools\\msys\\usr\\bin\\make.exe", "D:\\tools\\msys\\opt\\devkitpro\\devkitARM\\bin\\arm-none-eabi-gcc.exe"];
    const r = await new NodeToolchainLocator({ env: { GSDS_MSYS2_ROOT: "D:\\tools\\msys" }, exists: present([...custom, ...layoutA]) }).locate();
    expect(r).toMatchObject({ found: true, toolchain: { devkitProDir: "D:\\tools\\msys\\opt\\devkitpro" } });
  });

  it("ignores a DEVKITPRO that is an MSYS-side path", async () => {
    const r = await new NodeToolchainLocator({ env: { DEVKITPRO: "/opt/devkitpro" }, exists: present(layoutA) }).locate();
    expect(r).toMatchObject({ found: true, toolchain: { devkitProDir: "C:\\msys64\\opt\\devkitpro" } });
  });

  it("is not fooled by a half-finished install (make missing)", async () => {
    const r = await new NodeToolchainLocator({ env: {}, exists: present([layoutA[0], layoutA[2]]) }).locate();
    expect(r.found).toBe(false);
  });

  it("says what it searched and what to do when nothing is installed", async () => {
    const r = await new NodeToolchainLocator({ env: {}, exists: present([]) }).locate();
    expect(r).toMatchObject({ found: false, searched: ["C:\\msys64\\opt\\devkitpro", "C:\\devkitPro"] });
    if (!r.found) expect(r.message).toMatch(/setup-windows\.ps1/);
  });
});
