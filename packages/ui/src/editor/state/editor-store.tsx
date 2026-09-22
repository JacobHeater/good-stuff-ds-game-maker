import type { FpsTarget, ScreenId, SceneNode, SceneNodeKind, Vector3 } from "@goodstuff/core";
import {
  createBlankSceneTree,
  createSampleSceneTree,
  createSceneNode,
  duplicateSceneNode,
  findSceneNode,
  insertNodeAfterSibling,
  removeSceneNode,
  uniqueNodeName,
  updateSceneNode,
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
    outputLog: ["Good Stuff DS Game Maker ready.", `Loaded sample scene "${sceneRoot.name}".`]
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
  log: (message: string) => void;
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
