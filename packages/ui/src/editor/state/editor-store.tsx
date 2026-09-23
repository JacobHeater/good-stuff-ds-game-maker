import type { FpsTarget, ProjectSnapshot, ScreenId, SceneNode, SceneNodeKind, Vector3 } from "@goodstuff/core";
import {
  createBlankSceneTree,
  createProjectSnapshot,
  createSampleSceneTree,
  createSceneNode,
  duplicateSceneNode,
  findSceneNode,
  insertNodeAfterSibling,
  removeSceneNode,
  uniqueNodeName,
  updateSceneNode,
  withUpdatedScene,
  DS_HARDWARE_PROFILE
} from "@goodstuff/core";
import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";

export type WorkspaceId = "2D" | "3D" | "Script" | "Game";
export type BottomTabId = "Output" | "Debugger" | "Hardware";
export type ScreenFilter = "both" | ScreenId;
export type Transform3DField = "position" | "rotation" | "scale";

export interface EditorState {
  sceneRoot: SceneNode;
  selectedNodeId: string;
  activeWorkspace: WorkspaceId;
  activeBottomTab: BottomTabId;
  screenFilter: ScreenFilter;
  fpsTarget: FpsTarget;
  outputLog: string[];
  /** The last loaded/saved project snapshot; null until the first successful save. */
  project: ProjectSnapshot | null;
  /** Where `project` is saved on disk; null until the first successful save. */
  projectFilePath: string | null;
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
  | { type: "NEW_SCENE" }
  | { type: "ADD_NODE"; kind: SceneNodeKind }
  | { type: "DELETE_NODE"; id: string }
  | { type: "DUPLICATE_NODE"; id: string }
  | { type: "PROJECT_SAVED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_OPENED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_CLOSED" }
  | { type: "LOG"; message: string };

function createInitialState(): EditorState {
  const sceneRoot = createSampleSceneTree();
  return {
    sceneRoot,
    selectedNodeId: sceneRoot.id,
    activeWorkspace: "2D",
    activeBottomTab: "Output",
    screenFilter: "both",
    fpsTarget: DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget,
    outputLog: ["Good Stuff DS Game Maker ready.", `Loaded sample scene "${sceneRoot.name}".`],
    project: null,
    projectFilePath: null
  };
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "SELECT_NODE":
      return { ...state, selectedNodeId: action.id };
    case "SET_WORKSPACE":
      return { ...state, activeWorkspace: action.workspace };
    case "SET_BOTTOM_TAB":
      return { ...state, activeBottomTab: action.tab };
    case "SET_SCREEN_FILTER":
      return { ...state, screenFilter: action.filter };
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
    case "NEW_SCENE": {
      const sceneRoot = createBlankSceneTree();
      return {
        ...state,
        sceneRoot,
        selectedNodeId: sceneRoot.id,
        outputLog: [...state.outputLog, "Created new scene."]
      };
    }
    case "ADD_NODE": {
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
      return {
        ...state,
        sceneRoot: action.project.scene,
        selectedNodeId: action.project.scene.id,
        project: action.project,
        projectFilePath: action.filePath,
        outputLog: [...state.outputLog, `Opened project "${action.project.name}" from "${action.filePath}".`]
      };
    case "PROJECT_CLOSED": {
      const sceneRoot = createBlankSceneTree();
      return {
        ...state,
        sceneRoot,
        selectedNodeId: sceneRoot.id,
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
  newScene: () => void;
  addNode: (kind: SceneNodeKind) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  saveProject: () => Promise<void>;
  saveProjectAs: () => Promise<void>;
  openProject: () => Promise<void>;
  closeProject: () => void;
  log: (message: string) => void;
}

/** Builds the snapshot to persist: refreshes an existing project's scene, or mints a brand-new one. */
function buildSnapshotToSave(state: EditorState): ProjectSnapshot {
  return state.project
    ? withUpdatedScene(state.project, state.sceneRoot)
    : createProjectSnapshot({ name: "Untitled Project", mode: "2D", scene: state.sceneRoot });
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
  const newScene = useCallback(() => dispatch({ type: "NEW_SCENE" }), []);
  const addNode = useCallback((kind: SceneNodeKind) => dispatch({ type: "ADD_NODE", kind }), []);
  const deleteNode = useCallback((id: string) => dispatch({ type: "DELETE_NODE", id }), []);
  const duplicateNode = useCallback((id: string) => dispatch({ type: "DUPLICATE_NODE", id }), []);
  const log = useCallback((message: string) => dispatch({ type: "LOG", message }), []);

  const saveProject = useCallback(async () => {
    const snapshot = buildSnapshotToSave(state);
    const result = await window.goodstuff.project.save(state.projectFilePath, snapshot);
    if (result.outcome === "ok" && result.filePath) {
      dispatch({ type: "PROJECT_SAVED", filePath: result.filePath, project: snapshot });
    } else if (result.outcome === "error") {
      dispatch({ type: "LOG", message: `Save failed: ${result.message ?? "unknown error"}` });
    }
  }, [state]);

  const saveProjectAs = useCallback(async () => {
    const snapshot = buildSnapshotToSave(state);
    const result = await window.goodstuff.project.saveAs(snapshot);
    if (result.outcome === "ok" && result.filePath) {
      dispatch({ type: "PROJECT_SAVED", filePath: result.filePath, project: snapshot });
    } else if (result.outcome === "error") {
      dispatch({ type: "LOG", message: `Save failed: ${result.message ?? "unknown error"}` });
    }
  }, [state]);

  const openProject = useCallback(async () => {
    const result = await window.goodstuff.project.open();
    if (result.outcome === "ok" && result.filePath && result.snapshot) {
      dispatch({ type: "PROJECT_OPENED", filePath: result.filePath, project: result.snapshot });
    } else if (result.outcome === "error") {
      const detail = result.issues?.length ? `: ${result.issues.join("; ")}` : "";
      dispatch({ type: "LOG", message: `Open failed: ${result.message ?? "unknown error"}${detail}` });
    }
  }, []);

  const closeProject = useCallback(() => dispatch({ type: "PROJECT_CLOSED" }), []);

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
      newScene,
      addNode,
      deleteNode,
      duplicateNode,
      saveProject,
      saveProjectAs,
      openProject,
      closeProject,
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
      newScene,
      addNode,
      deleteNode,
      duplicateNode,
      saveProject,
      saveProjectAs,
      openProject,
      closeProject,
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
