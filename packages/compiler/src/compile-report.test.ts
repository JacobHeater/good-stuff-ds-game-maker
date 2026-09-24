import { describe, expect, it } from "vitest";

import { describeCompileResult } from "./compile-report";
import type { CompileResult } from "./compile-project";
import type { Diagnostic } from "./diagnostics";

const warning: Diagnostic = { severity: "warning", code: "omni-light-skipped", message: "Omni lights aren't supported.", nodeName: "Lamp" };
const error: Diagnostic = { severity: "error", code: "no-camera", message: "The scene has no Camera3D." };

describe("describeCompileResult", () => {
  it("lists diagnostics, then where the ROM went", () => {
    const result: CompileResult = { ok: true, romPath: "C:\\out\\game.nds", output: "", diagnostics: [warning] };
    expect(describeCompileResult(result)).toEqual([
      "Warning [Lamp]: Omni lights aren't supported.",
      'Exported ROM to "C:\\out\\game.nds".'
    ]);
  });

  it("names the node in a diagnostic and says an error stopped the build", () => {
    const result: CompileResult = { ok: false, reason: "diagnostics", message: "The scene has no Camera3D.", diagnostics: [error] };
    const lines = describeCompileResult(result);
    expect(lines[0]).toBe("Error: The scene has no Camera3D.");
    expect(lines[1]).toMatch(/no ROM was built/);
  });

  it("explains a missing toolchain, with the fix from the locator", () => {
    const result: CompileResult = {
      ok: false,
      reason: "toolchain-missing",
      message: "The Nintendo DS toolchain (devkitPro) isn't installed. Run setup-windows.ps1.",
      searched: [],
      diagnostics: []
    };
    expect(describeCompileResult(result)).toEqual(["Export failed: The Nintendo DS toolchain (devkitPro) isn't installed. Run setup-windows.ps1."]);
  });

  it("gives the toolchain's first error for a failed build, not its whole output", () => {
    const result: CompileResult = {
      ok: false,
      reason: "build-failed",
      message: "scene_data.c:4:1: error: boom",
      output: "lots\nof\nnoise",
      diagnostics: []
    };
    const lines = describeCompileResult(result);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("scene_data.c:4:1: error: boom");
    expect(lines[0]).not.toContain("noise");
  });

  it("reports a 2D project as unsupported, via the diagnostic", () => {
    const result: CompileResult = {
      ok: false,
      reason: "diagnostics",
      message: "Only 3D projects can be compiled so far; 2D compilation isn't supported yet.",
      diagnostics: [{ severity: "error", code: "not-a-3d-project", message: "Only 3D projects can be compiled so far; 2D compilation isn't supported yet." }]
    };
    expect(describeCompileResult(result)[0]).toContain("2D compilation isn't supported yet");
  });
});
