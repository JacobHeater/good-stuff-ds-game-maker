import type { CompileResult } from "./compile-project";
import { formatDiagnostic } from "./diagnostics";

/**
 * What a finished compile says, one line per entry, for the Output log: each diagnostic first, then
 * what stopped it, or (for an export) where the ROM went. A build failure adds the toolchain's first
 * error line (the full output is deliberately not dumped into the log). `action` is what the user
 * asked for, so failures read "Export failed" or "Play failed"; a successful Play adds nothing here,
 * since what it did next (launching the emulator) is the caller's to report.
 */
export function describeCompileResult(result: CompileResult, action: "Export" | "Play" = "Export"): string[] {
  const lines = result.diagnostics.map(formatDiagnostic);
  if (result.ok) {
    if (action === "Export") lines.push(`Exported ROM to "${result.romPath}".`);
    return lines;
  }
  switch (result.reason) {
    case "diagnostics":
      // The errors are already listed above; say what that means for the export.
      lines.push(`${action} stopped: the project has errors, so no ROM was built.`);
      break;
    case "toolchain-missing":
      lines.push(`${action} failed: ${result.message}`);
      break;
    case "build-failed":
      lines.push(`${action} failed: the DS toolchain reported an error. ${result.message}`);
      break;
    case "io-error":
      lines.push(`${action} failed: ${result.message}`);
      break;
  }
  return lines;
}
