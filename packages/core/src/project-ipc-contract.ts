import type { ProjectSnapshot } from "./project-snapshot";

/**
 * Shared shape for the renderer<->main project IPC calls (exposed via
 * the preload bridge as `window.goodstuff.project.*`, implemented in
 * `apps/desktop/src/main/project-ipc.ts`). Lives here — not in
 * `@goodstuff/persistence` or the desktop app itself — because both the
 * main process (which implements it) and the renderer (`@goodstuff/ui`,
 * which calls it) already depend on `@goodstuff/core`, and this is
 * plain, framework-agnostic data with no Electron or Node types in it.
 */
export type ProjectDialogOutcome = "ok" | "canceled" | "error";

export interface ProjectSaveResult {
  outcome: ProjectDialogOutcome;
  filePath?: string;
  message?: string;
  issues?: string[];
}

export interface ProjectOpenResult {
  outcome: ProjectDialogOutcome;
  filePath?: string;
  snapshot?: ProjectSnapshot;
  message?: string;
  issues?: string[];
}

export interface ProjectListResult {
  outcome: "ok" | "error";
  files?: string[];
  message?: string;
}

/**
 * The full shape of `window.goodstuff`, the preload bridge's exposed
 * API. Defined once here so the preload script (which implements it),
 * the desktop app's renderer `env.d.ts` (which declares the global),
 * and `@goodstuff/ui` (which calls it, and needs the same global
 * declared in its own compilation) can never drift apart.
 */
export interface GoodStuffWindowApi {
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  project: {
    save(filePath: string | null, snapshot: ProjectSnapshot): Promise<ProjectSaveResult>;
    saveAs(snapshot: ProjectSnapshot): Promise<ProjectSaveResult>;
    open(): Promise<ProjectOpenResult>;
    listDirectory(filePath: string): Promise<ProjectListResult>;
  };
}
