import type { ImportedMesh } from "./imported-mesh";
import type { ImportedTexture } from "./imported-texture";
import type { ProjectSnapshot } from "./project-snapshot";
import type { RecentProjectListing } from "./recent-projects";

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
 * The outcome of "Export ROM...". `lines` is what to show in the Output log, in order (diagnostics,
 * then where the ROM went or why there isn't one); it is empty when the user canceled.
 */
export interface ExportRomResult {
  outcome: ProjectDialogOutcome;
  romPath?: string;
  lines: string[];
}

/**
 * The outcome of "Import Model (.obj)...". On "ok", `mesh` is the parsed model (with a fresh id) and
 * `warnings` says what was ignored. On "error", `errors` says why the file was refused. On "canceled"
 * both are empty.
 */
export interface ImportMeshResult {
  outcome: ProjectDialogOutcome;
  mesh?: ImportedMesh;
  fileName?: string;
  warnings: string[];
  errors: string[];
}

/**
 * The outcome of importing a PNG as a texture. On "ok", `texture` is the picture already converted to the DS's
 * format (with a fresh id) and `warnings` says what was changed. On "error", `errors` says why it was refused.
 * On "canceled" both are empty.
 */
export interface ImportTextureResult {
  outcome: ProjectDialogOutcome;
  texture?: ImportedTexture;
  fileName?: string;
  warnings: string[];
  errors: string[];
}

/**
 * The outcome of asking for a sound file. On "ok", `bytes` is the file's content, undecoded: decoding audio needs the editor
 * window's decoder (WAV, MP3 and OGG), so the main process only picks and reads. On "error", `errors` says why the file
 * couldn't be read. On "canceled" both are empty.
 */
export interface PickSoundResult {
  outcome: ProjectDialogOutcome;
  fileName?: string;
  bytes?: Uint8Array;
  errors: string[];
}

/** The outcome of "Play". `lines` is for the Output log, in order. */
export interface PlayProjectResult {
  outcome: "ok" | "error";
  lines: string[];
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
    /** With no `filePath`, asks the user to pick a file; with one (e.g. from the recent list), opens it directly. */
    open(filePath?: string): Promise<ProjectOpenResult>;
    listDirectory(filePath: string): Promise<ProjectListResult>;
    /**
     * Compiles `snapshot` (as it is in the editor, saved or not) into a `.nds`. Never writes the project
     * file. `projectFilePath` only picks the save dialog's starting folder. A second call while one is
     * running resolves immediately with an "error" saying so.
     */
    exportRom(snapshot: ProjectSnapshot, projectFilePath: string | null): Promise<ExportRomResult>;
    /**
     * Builds `snapshot` (as it is in the editor, saved or not; the project file is never written) and runs
     * the ROM in an emulator, replacing any previous run. Resolves once the emulator has been started (or
     * the build or launch failed), not when the game ends.
     */
    play(snapshot: ProjectSnapshot): Promise<PlayProjectResult>;
  };
  /** Bringing files into a project. Reading and parsing happen in the main process; the renderer gets the result. */
  assets: {
    /** Asks the user for an .obj file and parses it. Never changes any project: the caller decides what to do with the model. */
    importMesh(): Promise<ImportMeshResult>;
    /** Asks the user for a .png file and converts it to a DS texture. Never changes any project. */
    importTexture(): Promise<ImportTextureResult>;
    /** Asks the user for a .wav, .mp3 or .ogg file and returns its bytes, for the renderer to decode. Never changes any project. */
    pickSound(): Promise<PickSoundResult>;
  };
  /**
   * Recently opened projects. Recording is done by the main process itself on
   * every successful open / save-as, so there is deliberately no `record`
   * here: the renderer can read and prune the list, not write to it.
   */
  recents: {
    list(): Promise<RecentProjectListing[]>;
    /** Forgets one project (the file on disk is untouched). Resolves to the updated list. */
    remove(path: string): Promise<RecentProjectListing[]>;
    /** Forgets every project. Resolves to the (now empty) list. */
    clear(): Promise<RecentProjectListing[]>;
  };
  /** Window-level coordination with the main process, for the unsaved-changes guard. */
  app: {
    /** Tells the main process whether the open project has unsaved edits, so it can hold a window close. */
    setUnsavedChanges(hasUnsavedChanges: boolean): void;
    /** Called when the user tries to close the window while there are unsaved edits. Returns an unsubscribe function. */
    onCloseRequested(listener: () => void): () => void;
    /** Closes the window for real, bypassing the unsaved-changes hold. Call only after the user has decided. */
    confirmClose(): void;
  };
}
