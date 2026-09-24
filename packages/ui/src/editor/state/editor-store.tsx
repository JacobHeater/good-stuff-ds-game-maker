import type {
  FpsTarget,
  ProjectMode,
  ProjectSnapshot,
  ScreenId,
  SceneNode,
  SceneNodeKind,
  Vector3
} from "@goodstuff/core";
import {
  createBlankSceneTree,
  createProjectSnapshot,
  createSceneNode,
  duplicateSceneNode,
  findSceneNode,
  insertNodeAfterSibling,
  isNodeKindAllowedInMode,
  removeSceneNode,
  uniqueNodeName,
  updateSceneNode,
  withUpdatedScene,
  DS_HARDWARE_PROFILE
} from "@goodstuff/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

export type WorkspaceId = "2D" | "3D" | "Script" | "Game";
export type BottomTabId = "Output" | "Debugger" | "Hardware";
export type ScreenFilter = "both" | ScreenId;
export type Transform3DField = "position" | "rotation" | "scale";

/** Result of a project action that the calling screen needs to react to (the startup screen has no Output log to show errors in). */
export interface ProjectActionResult {
  outcome: "ok" | "canceled" | "error";
  message?: string;
}

export interface EditorState {
  sceneRoot: SceneNode;
  selectedNodeId: string;
  activeWorkspace: WorkspaceId;
  activeBottomTab: BottomTabId;
  screenFilter: ScreenFilter;
  fpsTarget: FpsTarget;
  outputLog: string[];
  /**
   * The open project, or null when none is open (the startup view is shown).
   * Its `mode` is permanent — nothing in this store ever changes it.
   */
  project: ProjectSnapshot | null;
  /** Where `project` is saved on disk. */
  projectFilePath: string | null;
}

/**
 * True when the open project has edits that aren't in its file. The reducer
 * builds a new scene tree for every edit and only `loadProject` (open/create)
 * or a save puts the saved tree back, so "not the same tree as the saved
 * project's" is exactly "edited since the last save or open" — no per-action
 * flag to forget to set. (A false positive is possible: an edit that's later
 * reverted by hand still reads as unsaved. Undo/redo will refine this.)
 */
export function hasUnsavedChanges(state: Pick<EditorState, "project" | "sceneRoot">): boolean {
  return state.project !== null && state.sceneRoot !== state.project.scene;
}

/** What the user is being asked to save before, e.g. "close this project". */
export interface UnsavedChangesPrompt {
  action: string;
}

export type UnsavedChangesChoice = "save" | "discard" | "cancel";

/** The workspace tabs a project of `mode` may show: its own viewport, plus the mode-independent Script/Game tabs. */
export function workspacesForMode(mode: ProjectMode): WorkspaceId[] {
  return [mode, "Script", "Game"];
}

/** The DS's 3D engine can only drive one screen at a time, so a 3D project never shows "both". */
function screenFilterForMode(filter: ScreenFilter, mode: ProjectMode): ScreenFilter {
  return mode === "3D" && filter === "both" ? "top" : filter;
}

type Action =
  | { type: "SELECT_NODE"; id: string }
  | { type: "SET_WORKSPACE"; workspace: WorkspaceId }
  | { type: "SET_BOTTOM_TAB"; tab: BottomTabId }
  | { type: "SET_SCREEN_FILTER"; filter: ScreenFilter }
  | { type: "SET_FPS_TARGET"; fps: FpsTarget }
  | { type: "MOVE_NODE"; id: string; x: number; y: number }
  | { type: "SET_TRANSFORM_3D"; id: string; field: Transform3DField; value: Vector3 }
  | { type: "TOGGLE_VISIBLE"; id: string }
  | { type: "ADD_NODE"; kind: SceneNodeKind }
  | { type: "DELETE_NODE"; id: string }
  | { type: "DUPLICATE_NODE"; id: string }
  | { type: "PROJECT_SAVED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_OPENED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_CREATED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_CLOSED" }
  | { type: "LOG"; message: string };

function createInitialState(): EditorState {
  const sceneRoot = createBlankSceneTree("2D");
  return {
    sceneRoot,
    selectedNodeId: sceneRoot.id,
    activeWorkspace: "2D",
    activeBottomTab: "Output",
    screenFilter: "both",
    fpsTarget: DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget,
    outputLog: ["Good Stuff DS Game Maker ready."],
    project: null,
    projectFilePath: null
  };
}

/** Loads `project` into the editor already configured for its committed mode. */
function loadProject(state: EditorState, project: ProjectSnapshot, filePath: string, logMessage: string): EditorState {
  return {
    ...state,
    sceneRoot: project.scene,
    selectedNodeId: project.scene.id,
    activeWorkspace: project.mode,
    screenFilter: screenFilterForMode(state.screenFilter, project.mode),
    project,
    projectFilePath: filePath,
    outputLog: [...state.outputLog, logMessage]
  };
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "SELECT_NODE":
      return { ...state, selectedNodeId: action.id };
    case "SET_WORKSPACE":
      // A project's mode is permanent: never switch to the other mode's viewport tab.
      if (!state.project || !workspacesForMode(state.project.mode).includes(action.workspace)) return state;
      return { ...state, activeWorkspace: action.workspace };
    case "SET_BOTTOM_TAB":
      return { ...state, activeBottomTab: action.tab };
    case "SET_SCREEN_FILTER":
      return {
        ...state,
        screenFilter: state.project ? screenFilterForMode(action.filter, state.project.mode) : action.filter
      };
    case "SET_FPS_TARGET":
      return { ...state, fpsTarget: action.fps };
    case "MOVE_NODE":
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({
          ...node,
          position: { x: action.x, y: action.y }
        }))
      };
    case "SET_TRANSFORM_3D":
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) =>
          node.transform3D
            ? { ...node, transform3D: { ...node.transform3D, [action.field]: action.value } }
            : node
        )
      };
    case "TOGGLE_VISIBLE":
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, visible: !node.visible }))
      };
    case "ADD_NODE": {
      if (!state.project || !isNodeKindAllowedInMode(action.kind, state.project.mode)) return state;
      const parent = findSceneNode(state.sceneRoot, state.selectedNodeId) ?? state.sceneRoot;
      const name = uniqueNodeName(
        action.kind,
        parent.children.map((child) => child.name)
      );
      const newNode = createSceneNode({ name, kind: action.kind, screen: parent.screen });
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, parent.id, (node) => ({
          ...node,
          children: [...node.children, newNode]
        })),
        selectedNodeId: newNode.id,
        outputLog: [...state.outputLog, `Added ${action.kind} node "${name}".`]
      };
    }
    case "DELETE_NODE": {
      if (action.id === state.sceneRoot.id) return state;
      const node = findSceneNode(state.sceneRoot, action.id);
      if (!node) return state;
      const sceneRoot = removeSceneNode(state.sceneRoot, action.id);
      return {
        ...state,
        sceneRoot,
        selectedNodeId: state.selectedNodeId === action.id ? sceneRoot.id : state.selectedNodeId,
        outputLog: [...state.outputLog, `Deleted node "${node.name}".`]
      };
    }
    case "DUPLICATE_NODE": {
      if (action.id === state.sceneRoot.id) return state;
      const node = findSceneNode(state.sceneRoot, action.id);
      if (!node) return state;
      const clone = duplicateSceneNode(node);
      return {
        ...state,
        sceneRoot: insertNodeAfterSibling(state.sceneRoot, action.id, clone),
        selectedNodeId: clone.id,
        outputLog: [...state.outputLog, `Duplicated node "${node.name}".`]
      };
    }
    case "PROJECT_SAVED":
      return {
        ...state,
        project: action.project,
        projectFilePath: action.filePath,
        outputLog: [...state.outputLog, `Saved project to "${action.filePath}".`]
      };
    case "PROJECT_OPENED":
      return loadProject(
        state,
        action.project,
        action.filePath,
        `Opened ${action.project.mode} project "${action.project.name}" from "${action.filePath}".`
      );
    case "PROJECT_CREATED":
      return loadProject(
        state,
        action.project,
        action.filePath,
        `Created ${action.project.mode} project "${action.project.name}" at "${action.filePath}".`
      );
    case "PROJECT_CLOSED": {
      const sceneRoot = createBlankSceneTree("2D");
      return {
        ...state,
        sceneRoot,
        selectedNodeId: sceneRoot.id,
        activeWorkspace: "2D",
        project: null,
        projectFilePath: null,
        outputLog: [...state.outputLog, "Closed project."]
      };
    }
    case "LOG":
      return { ...state, outputLog: [...state.outputLog, action.message] };
    default:
      return state;
  }
}

interface EditorStoreValue {
  state: EditorState;
  selectNode: (id: string) => void;
  setWorkspace: (workspace: WorkspaceId) => void;
  setBottomTab: (tab: BottomTabId) => void;
  setScreenFilter: (filter: ScreenFilter) => void;
  setFpsTarget: (fps: FpsTarget) => void;
  moveNode: (id: string, x: number, y: number) => void;
  setTransform3D: (id: string, field: Transform3DField, value: Vector3) => void;
  toggleVisible: (id: string) => void;
  addNode: (kind: SceneNodeKind) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  /** Creates a new project of `mode` (permanent), asks where to save it, and opens it. */
  createProject: (name: string, mode: ProjectMode) => Promise<ProjectActionResult>;
  /** Resolves true only if the project was actually written (not canceled, not failed). */
  saveProject: () => Promise<boolean>;
  saveProjectAs: () => Promise<boolean>;
  /**
   * Opens a project, replacing the open one. With no `filePath` the user picks a
   * file; with one (from the recent list) it's opened directly. If the open
   * project has unsaved edits the user is asked first (see `unsavedPrompt`), and
   * the result stays pending until they answer; Cancel resolves "canceled".
   */
  openProject: (filePath?: string) => Promise<ProjectActionResult>;
  /** Closes the project and returns to the startup view, asking first if it has unsaved edits. */
  closeProject: () => void;
  /**
   * Compiles the project as it is in the editor (unsaved edits included, nothing saved) into a `.nds`
   * the user chooses the location of, and reports to the Output log. Does nothing if one is running.
   */
  exportRom: () => Promise<void>;
  /** True while an export is running. */
  exporting: boolean;
  /**
   * Builds the project as it is in the editor (unsaved edits included, nothing saved) and runs it in an
   * emulator, replacing any previous run, reporting to the Output log. Does nothing while a build is running.
   */
  play: () => Promise<void>;
  /** True while Play is building (the emulator, once started, runs on its own). */
  playing: boolean;
  /** True while the open project has edits that aren't in its file. */
  hasUnsavedChanges: boolean;
  /** Set while the Save / Don't Save / Cancel prompt should be showing. */
  unsavedPrompt: UnsavedChangesPrompt | null;
  resolveUnsavedPrompt: (choice: UnsavedChangesChoice) => Promise<void>;
  log: (message: string) => void;
}

function describeFailure(result: { message?: string; issues?: string[] }): string {
  const detail = result.issues?.length ? `: ${result.issues.join("; ")}` : "";
  return `${result.message ?? "unknown error"}${detail}`;
}

const EditorStoreContext = createContext<EditorStoreValue | null>(null);

export function EditorStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  const selectNode = useCallback((id: string) => dispatch({ type: "SELECT_NODE", id }), []);
  const setWorkspace = useCallback((workspace: WorkspaceId) => dispatch({ type: "SET_WORKSPACE", workspace }), []);
  const setBottomTab = useCallback((tab: BottomTabId) => dispatch({ type: "SET_BOTTOM_TAB", tab }), []);
  const setScreenFilter = useCallback((filter: ScreenFilter) => dispatch({ type: "SET_SCREEN_FILTER", filter }), []);
  const setFpsTarget = useCallback((fps: FpsTarget) => dispatch({ type: "SET_FPS_TARGET", fps }), []);
  const moveNode = useCallback((id: string, x: number, y: number) => dispatch({ type: "MOVE_NODE", id, x, y }), []);
  const setTransform3D = useCallback(
    (id: string, field: Transform3DField, value: Vector3) => dispatch({ type: "SET_TRANSFORM_3D", id, field, value }),
    []
  );
  const toggleVisible = useCallback((id: string) => dispatch({ type: "TOGGLE_VISIBLE", id }), []);
  const addNode = useCallback((kind: SceneNodeKind) => dispatch({ type: "ADD_NODE", kind }), []);
  const deleteNode = useCallback((id: string) => dispatch({ type: "DELETE_NODE", id }), []);
  const duplicateNode = useCallback((id: string) => dispatch({ type: "DUPLICATE_NODE", id }), []);
  const log = useCallback((message: string) => dispatch({ type: "LOG", message }), []);

  const createProject = useCallback(async (name: string, mode: ProjectMode): Promise<ProjectActionResult> => {
    const snapshot = createProjectSnapshot({ name, mode, scene: createBlankSceneTree(mode) });
    const result = await window.goodstuff.project.saveAs(snapshot);
    if (result.outcome === "ok" && result.filePath) {
      dispatch({ type: "PROJECT_CREATED", filePath: result.filePath, project: snapshot });
      return { outcome: "ok" };
    }
    if (result.outcome === "error") {
      return { outcome: "error", message: `Could not create the project: ${describeFailure(result)}` };
    }
    return { outcome: "canceled" };
  }, []);

  const saveProject = useCallback(async (): Promise<boolean> => {
    if (!state.project) return false;
    const snapshot = withUpdatedScene(state.project, state.sceneRoot);
    const result = await window.goodstuff.project.save(state.projectFilePath, snapshot);
    if (result.outcome === "ok" && result.filePath) {
      dispatch({ type: "PROJECT_SAVED", filePath: result.filePath, project: snapshot });
      return true;
    }
    if (result.outcome === "error") {
      dispatch({ type: "LOG", message: `Save failed: ${describeFailure(result)}` });
    }
    return false;
  }, [state.project, state.projectFilePath, state.sceneRoot]);

  const saveProjectAs = useCallback(async (): Promise<boolean> => {
    if (!state.project) return false;
    const snapshot = withUpdatedScene(state.project, state.sceneRoot);
    const result = await window.goodstuff.project.saveAs(snapshot);
    if (result.outcome === "ok" && result.filePath) {
      dispatch({ type: "PROJECT_SAVED", filePath: result.filePath, project: snapshot });
      return true;
    }
    if (result.outcome === "error") {
      dispatch({ type: "LOG", message: `Save failed: ${describeFailure(result)}` });
    }
    return false;
  }, [state.project, state.sceneRoot]);

  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);

  const exportRom = useCallback(async (): Promise<void> => {
    if (!state.project || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const snapshot = withUpdatedScene(state.project, state.sceneRoot);
      const result = await window.goodstuff.project.exportRom(snapshot, state.projectFilePath);
      for (const line of result.lines) dispatch({ type: "LOG", message: line });
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [state.project, state.projectFilePath, state.sceneRoot]);

  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);

  const play = useCallback(async (): Promise<void> => {
    if (!state.project || playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    try {
      const snapshot = withUpdatedScene(state.project, state.sceneRoot);
      const result = await window.goodstuff.project.play(snapshot);
      for (const line of result.lines) dispatch({ type: "LOG", message: line });
    } finally {
      playingRef.current = false;
      setPlaying(false);
    }
  }, [state.project, state.sceneRoot]);

  // --- Unsaved-changes guard: one prompt for every action that would discard edits. ---
  const [unsavedPrompt, setUnsavedPrompt] = useState<UnsavedChangesPrompt | null>(null);
  const pendingGuardRef = useRef<{ proceed: () => void | Promise<void>; cancel: () => void } | null>(null);
  const dirty = hasUnsavedChanges(state);

  /** Runs `proceed` now if nothing would be lost; otherwise asks first. `cancel` runs if the user backs out. */
  const guardUnsavedChanges = useCallback(
    (action: string, proceed: () => void | Promise<void>, cancel: () => void = () => undefined): void => {
      if (!dirty) {
        void proceed();
        return;
      }
      pendingGuardRef.current = { proceed, cancel };
      setUnsavedPrompt({ action });
    },
    [dirty]
  );

  const resolveUnsavedPrompt = useCallback(
    async (choice: UnsavedChangesChoice): Promise<void> => {
      const pending = pendingGuardRef.current;
      pendingGuardRef.current = null;
      setUnsavedPrompt(null);
      if (!pending) return;
      if (choice === "cancel") {
        pending.cancel();
        return;
      }
      // If saving is canceled or fails, the action is abandoned and nothing is lost.
      if (choice === "save" && !(await saveProject())) {
        pending.cancel();
        return;
      }
      await pending.proceed();
    },
    [saveProject]
  );

  const openProject = useCallback(
    (filePath?: string): Promise<ProjectActionResult> =>
      new Promise((resolve) => {
        guardUnsavedChanges(
          "open another project",
          async () => {
            const result = await window.goodstuff.project.open(filePath);
            if (result.outcome === "ok" && result.filePath && result.snapshot) {
              dispatch({ type: "PROJECT_OPENED", filePath: result.filePath, project: result.snapshot });
              resolve({ outcome: "ok" });
            } else if (result.outcome === "error") {
              const message = `Open failed: ${describeFailure(result)}`;
              dispatch({ type: "LOG", message });
              resolve({ outcome: "error", message });
            } else {
              resolve({ outcome: "canceled" });
            }
          },
          () => resolve({ outcome: "canceled" })
        );
      }),
    [guardUnsavedChanges]
  );

  const closeProject = useCallback(
    () => guardUnsavedChanges("close this project", () => dispatch({ type: "PROJECT_CLOSED" })),
    [guardUnsavedChanges]
  );

  // Tell the main process whether edits are unsaved, and answer its "the window is being closed" request.
  useEffect(() => {
    window.goodstuff.app.setUnsavedChanges(dirty);
  }, [dirty]);

  const guardRef = useRef(guardUnsavedChanges);
  guardRef.current = guardUnsavedChanges;
  useEffect(
    () =>
      window.goodstuff.app.onCloseRequested(() =>
        guardRef.current("close the window", () => window.goodstuff.app.confirmClose())
      ),
    []
  );

  const value = useMemo<EditorStoreValue>(
    () => ({
      state,
      selectNode,
      setWorkspace,
      setBottomTab,
      setScreenFilter,
      setFpsTarget,
      moveNode,
      setTransform3D,
      toggleVisible,
      addNode,
      deleteNode,
      duplicateNode,
      createProject,
      saveProject,
      saveProjectAs,
      openProject,
      closeProject,
      exportRom,
      exporting,
      play,
      playing,
      hasUnsavedChanges: dirty,
      unsavedPrompt,
      resolveUnsavedPrompt,
      log
    }),
    [
      state,
      selectNode,
      setWorkspace,
      setBottomTab,
      setScreenFilter,
      setFpsTarget,
      moveNode,
      setTransform3D,
      toggleVisible,
      addNode,
      deleteNode,
      duplicateNode,
      createProject,
      saveProject,
      saveProjectAs,
      openProject,
      closeProject,
      exportRom,
      exporting,
      play,
      playing,
      dirty,
      unsavedPrompt,
      resolveUnsavedPrompt,
      log
    ]
  );

  return <EditorStoreContext.Provider value={value}>{children}</EditorStoreContext.Provider>;
}

export function useEditorStore(): EditorStoreValue {
  const ctx = useContext(EditorStoreContext);
  if (!ctx) {
    throw new Error("useEditorStore must be used within an EditorStoreProvider");
  }
  return ctx;
}
