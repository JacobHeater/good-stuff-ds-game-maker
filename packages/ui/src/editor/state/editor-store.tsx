import type {
  AudioClip,
  AudioPlayerData,
  LabelData,
  FpsTarget,
  ImportedMesh,
  ImportedSound,
  ImportedSprite,
  RiggedModel,
  TouchArea2DData,
  TouchArea3DShape,
  ImportedTexture,
  SpriteAnimation,
  SpriteAnimationsData,
  MeshCullMode,
  MeshInstance3DData,
  MeshPrimitive,
  ProjectMode,
  ProjectScript,
  ProjectSnapshot,
  ScreenId,
  SceneNode,
  SceneNodeKind,
  Vector3
} from "@goodstuff/core";
import {
  clampPitch,
  clampVolume,
  createBlankSceneTree,
  createProjectSnapshot,
  getThreeDScreen,
  isTwoDVisualKind,
  otherScreen,
  screenForKind,
  withThreeDScreen,
  createSceneNode,
  animatableProperties,
  clampAnimationLength,
  clampAnimationSpeed,
  currentValueOf,
  getAnimationPlayer,
  insertKey,
  isValueForProperty,
  uniqueAnimationName,
  withoutTracksFor,
  type AnimationPlayerData,
  type AnimationProperty,
  type AnimationValue,
  DEFAULT_AUDIO_PLAYER,
  getCollisionShape,
  normalizeCollisionShape,
  type CollisionShapeData,
  type CollisionShapeKind,
  duplicateSceneNode,
  ensureNodeIdsAbove,
  findSceneNode,
  flattenSceneTree,
  flattenSceneTreeInOrder,
  isCurrentCamera,
  formatSoundTime,
  getAudioPlayer,
  MAX_EXTRA_AUDIO_CLIPS,
  getImportedTriangleCount,
  importGltf,
  readGltfFile,
  parseMeshColor,
  meshColorFromLevels,
  getImportedFrameCount,
  getMeshFrameCount,
  getLightIntensity,
  getPrimitiveTriangleCount,
  getSoundByteSize,
  getSoundDurationSeconds,
  getSpriteByteSize,
  getSpriteFrames,
  getSpriteAnimations,
  clampSpriteAnimationFps,
  createSpriteAnimation,
  nextAnimationName,
  getSpriteTransform,
  normalizeSpriteTransform,
  getTextureByteSize,
  getLabel,
  MAX_LABEL_CHARS,
  getTouchArea2D,
  getTouchArea3D,
  normalizeTouchArea2D,
  normalizeTouchArea3D,
  insertNodeAfterSibling,
  meshSourceKey,
  NEW_SCRIPT_SOURCE,
  resolveMeshGeometry,
  isNodeKindAllowedInMode,
  removeSceneNode,
  uniqueNodeName,
  copyName,
  moveSceneNodes,
  topMostNodes,
  type DropPosition,
  uniqueScriptName,
  updateSceneNode,
  DS_HARDWARE_PROFILE,
  getTileMap,
  resizeTileMapGrid,
  setTileSolid,
  type TileMapData
} from "@goodstuff/core";
import { decodeSoundFile } from "../audio/decode-sound";
import { classifyFocus, resolveShortcut, type ShortcutCommand, type ShortcutContext } from "./keyboard-shortcuts";
import { DEFAULT_START_SCENE_ID, flattenAllScenes, instanceWouldCycle, listScenes, newSceneId, outerNodeId, pruneUnusedAssets, uniqueSceneName, withSceneEntries, withSceneTree, type SceneEntry } from "@goodstuff/core";
import { EMPTY_HISTORY, endGesture, recordEdit, redoStep, undoStep, type EditHistory, type EditState } from "./edit-history";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

export type WorkspaceId = "2D" | "3D" | "Script" | "Game";
export type BottomTabId = "Output" | "Debugger" | "Hardware" | "Animation";
export type ScreenFilter = "both" | ScreenId;
export type Transform3DField = "position" | "rotation" | "scale";
/**
 * The toolbar's editing tools (3D projects). "select" shows no manipulator; the others put the matching
 * gizmo on the selected node. Editor state only: never saved, and choosing one is not an edit.
 */
/** Where a newly added DirectionalLight3D points (degrees, XYZ Euler): down 45 degrees and turned 30 to the side. */
export const NEW_DIRECTIONAL_LIGHT_ROTATION = { x: -45, y: -30, z: 0 } as const;

export type EditorTool = "select" | "move" | "rotate" | "scale";
/** The settings of an audio player that can be edited one at a time (the sound itself is chosen with `setAudioSound`). */
export type AudioPlayerChange = Partial<Pick<AudioPlayerData, "autoplay" | "volume" | "pitch" | "loop">>;
/** A named clip's own settings, edited one at a time; `soundId: null` clears its sound. */
export type AudioClipChange = Partial<Pick<AudioClip, "volume" | "pitch" | "loop">> & { soundId?: string | null };
/** What can be edited on a collision shape: any of these at once (a box's size may name just some of its axes). */
/** A change to a Sprite2D's rotation (degrees, clockwise) and/or its scale on each axis. */
/** What the animation editor changes about one animation of an AnimatedSprite2D; the fields given are the ones that change. */
export interface SpriteAnimationChange {
  name?: string;
  frames?: number[];
  fps?: number;
  loop?: boolean;
}

/**
 * An AnimatedSprite2D whose sheet has changed: frames of its animations that the new sheet doesn't have are dropped (and an animation left with none goes), so a saved project
 * never names a frame that isn't there. A start animation that went is forgotten.
 */
function fitAnimationsToSheet(node: SceneNode, sheet: ImportedSprite | undefined): SceneNode {
  if (!node.spriteAnimations) return node;
  const count = sheet ? getSpriteFrames(sheet).count : Number.POSITIVE_INFINITY;
  const data = getSpriteAnimations(node);
  const animations = data.animations.map((animation) => ({ ...animation, frames: animation.frames.filter((frame) => frame < count) })).filter((animation) => animation.frames.length > 0);
  const start = data.start !== undefined && animations.some((animation) => animation.name === data.start) ? data.start : undefined;
  return { ...node, spriteAnimations: { animations, ...(start !== undefined ? { start } : {}) } };
}

/** A sheet just put on an AnimatedSprite2D that has no animations yet: one that plays every frame, from the start, so the picture moves at once. */
function withDefaultAnimation(node: SceneNode, frameCount: number): SceneNode {
  if (frameCount < 2 || getSpriteAnimations(node).animations.length > 0) return node;
  const animation = createSpriteAnimation("default", Array.from({ length: frameCount }, (_, i) => i));
  return { ...node, spriteAnimations: { animations: [animation], start: animation.name } };
}

export interface SpriteTransformChange {
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

/** A change to a Label's text and/or color. */
export type LabelChange = Partial<LabelData>;
/** A change to a TouchArea2D's rectangle: any of its fields. */
export type TouchArea2DChange = Partial<TouchArea2DData>;
/** A change to a TouchArea3D: its shape, some of its box size, or its radius. */
export interface TouchArea3DChange {
  shape?: TouchArea3DShape;
  size?: Partial<Vector3>;
  radius?: number;
}

export interface CollisionShapeChange {
  shape?: CollisionShapeKind;
  size?: Partial<{ x: number; y: number; z: number }>;
  radius?: number;
  height?: number;
  solid?: boolean;
}
/** A change to a TileMap's sheet or grid size (painting a cell and marking a tile solid are their own actions, below). */
export interface TileMapChange {
  spriteId?: string | null;
  columns?: number;
  rows?: number;
}
/** What a mesh is made of: one of the built-in shapes, or a model imported into the project. */
export type MeshSource = { primitive: MeshPrimitive } | { importedMeshId: string };

/** Result of a project action that the calling screen needs to react to (the startup screen has no Output log to show errors in). */
export interface ProjectActionResult {
  outcome: "ok" | "canceled" | "error";
  message?: string;
}

export interface EditorState {
  sceneRoot: SceneNode;
  /** The node the Inspector and the viewports work on: the one last clicked. */
  selectedNodeId: string;
  /**
   * Other nodes selected along with `selectedNodeId` (Ctrl+click, Shift+click). Delete, Duplicate and dragging in the Scene tree act on all of them. Never holds the primary
   * node, or a node that is not in the scene (`normalizeSelection` keeps it so).
   */
  extraSelectedIds: string[];
  /** Where a Shift+click range starts: the node last selected without Shift. */
  selectionAnchorId: string;
  /**
   * Nodes whose children are folded away in the Scene tree. Only the tree's look: not saved with the project and not an edit (no undo step). Selecting a node inside
   * a folded one unfolds the way to it (`normalizeSelection`).
   */
  collapsedNodeIds: string[];
  activeWorkspace: WorkspaceId;
  activeBottomTab: BottomTabId;
  screenFilter: ScreenFilter;
  fpsTarget: FpsTarget;
  activeTool: EditorTool;
  /** Undo/redo steps for scene edits. Reset whenever a project is opened, created or closed. */
  history: EditHistory;
  outputLog: string[];
  /**
   * The open project, or null when none is open (the startup view is shown).
   * Its `mode` is permanent — nothing in this store ever changes it.
   */
  project: ProjectSnapshot | null;
  /** Where `project` is saved on disk. */
  projectFilePath: string | null;
  /**
   * The scene being edited (`sceneRoot` is its tree). The project's own copy of that tree is stale while it is edited, like `project.scene` always was; `savedProjectOf` puts the live tree
   * in. Switching scene is not an edit.
   */
  activeSceneId: string;
  /** The project's scenes as they were when it was last opened or saved (trees by reference): what "unsaved" compares with. */
  savedScenes: SceneEntry[] | undefined;
  /**
   * The project's scripts as they were when it was last opened or saved. A script edit changes `project.scripts` but not the scene tree, so this
   * is what "unsaved" compares them with; undoing back to it (by reference, like the scene tree) reads as clean.
   */
  savedScripts: ProjectScript[] | undefined;
  /** The script open in the Script tab, or null. Editor state: never saved, and choosing one is not an edit. */
  selectedScriptId: string | null;
  /** The Animation panel's own state: what is selected, and the preview. Editor state: never saved, and none of it is an edit. */
  animationUi: AnimationUi;
}

/** Which animation, track and key the Animation panel has selected, and the preview shown in the viewport (`previewTime` null = no preview). */
export interface AnimationUi {
  /** The AnimationPlayer the panel is editing: the last one selected (it stays while other nodes are selected, so a node's values can be changed between keys). */
  playerId: string | null;
  animationId: string | null;
  trackId: string | null;
  /** The selected key of the selected track, by its time. */
  keyTime: number | null;
  previewTime: number | null;
  previewPlaying: boolean;
}
export const EMPTY_ANIMATION_UI: AnimationUi = { playerId: null, animationId: null, trackId: null, keyTime: null, previewTime: null, previewPlaying: false };

/**
 * True when the open project has edits that aren't in its file. The reducer
 * builds a new scene tree for every edit and only `loadProject` (open/create)
 * or a save puts the saved tree back, so "not the same tree as the saved
 * project's" is exactly "edited since the last save or open" — no per-action
 * flag to forget to set. Undo/redo keeps this exact: history holds references
 * to the trees themselves, so undoing back to the saved tree makes the two
 * references equal again and the project reads as clean. (An edit reverted by
 * hand, rather than by undo, still reads as unsaved.)
 */
export function hasUnsavedChanges(state: Pick<EditorState, "project" | "sceneRoot" | "savedScripts"> & Partial<Pick<EditorState, "activeSceneId" | "savedScenes">>): boolean {
  if (state.project === null) return false;
  if (state.project.scripts !== state.savedScripts) return true;
  if (!state.savedScenes || state.activeSceneId === undefined) return state.sceneRoot !== state.project.scene;
  // Every scene must be the tree it was (by reference), under the name it had, in the place it had.
  const now = listScenes(withSceneTree(state.project, state.activeSceneId, state.sceneRoot));
  return now.length !== state.savedScenes.length || now.some((entry, i) => entry.id !== state.savedScenes![i].id || entry.name !== state.savedScenes![i].name || entry.isStart !== state.savedScenes![i].isStart || entry.scene !== state.savedScenes![i].scene);
}

/** The project as it would be saved: the scene being edited put into it, and the assets no scene uses left out. */
export function savedProjectOf(state: Pick<EditorState, "project" | "sceneRoot" | "activeSceneId">): ProjectSnapshot {
  const project = withSceneTree(state.project!, state.activeSceneId, state.sceneRoot);
  return pruneUnusedAssets({ ...project, updatedAt: new Date().toISOString() });
}

/** The project's scenes with the scene being edited as it is now. */
function currentSceneEntries(state: Pick<EditorState, "project" | "sceneRoot" | "activeSceneId">): SceneEntry[] {
  return state.project ? listScenes(withSceneTree(state.project, state.activeSceneId, state.sceneRoot)) : [];
}

/** `entries` become the project's scenes and `activeId` the one being edited (its tree is the scene tree, and nothing in it is selected but its root). */
function withScenes(state: EditorState, entries: readonly SceneEntry[], activeId: string): EditorState {
  const active = entries.find((entry) => entry.id === activeId) ?? entries[0];
  const project = withSceneEntries(state.project!, entries);
  const changedScene = active.id !== state.activeSceneId;
  return {
    ...state,
    project,
    activeSceneId: active.id,
    sceneRoot: active.scene,
    selectedNodeId: changedScene || !findSceneNode(active.scene, state.selectedNodeId) ? active.scene.id : state.selectedNodeId,
    extraSelectedIds: changedScene ? [] : state.extraSelectedIds,
    selectionAnchorId: changedScene ? active.scene.id : state.selectionAnchorId,
    collapsedNodeIds: changedScene ? [] : state.collapsedNodeIds,
    screenFilter: changedScene && project.mode === "3D" ? active.scene.screen : state.screenFilter,
    animationUi: changedScene ? EMPTY_ANIMATION_UI : state.animationUi
  };
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

/** The sound and animation players aren't drawn by either engine. */
const isEngineIndependent = (kind: SceneNodeKind): boolean => kind === "AudioStreamPlayer" || kind === "AnimationPlayer";

/** The screen a new node of `kind` goes on: in a 3D project by what draws it (the scene root records which screen is 3D), in a 2D project with its parent. */
function screenOfNewNode(state: EditorState, kind: SceneNodeKind, parent: SceneNode): ScreenId {
  return state.project?.mode === "3D" ? screenForKind(kind, state.sceneRoot.screen) : parent.screen;
}

/** The two screens of the open 3D project (the 3D engine's and the 2D one), or null when a 2D project (or none) is open. */
export function screenRolesOf(state: EditorState): { threeD: ScreenId; twoD: ScreenId } | null {
  const threeD = state.project ? getThreeDScreen({ mode: state.project.mode, scene: state.sceneRoot }) : null;
  return threeD ? { threeD, twoD: otherScreen(threeD) } : null;
}

export type Action =
  | { type: "SELECT_NODE"; id: string }
  /** Ctrl+click (toggle the node in the selection) or Shift+click (select the range from the anchor to the node). */
  | { type: "SELECT_NODE_MODIFIED"; id: string; mode: "toggle" | "range" }
  /** Deletes the nodes (the whole selection when `ids` is left out); what is under a node goes with it. */
  | { type: "DELETE_NODES"; ids?: string[] }
  /** Duplicates the nodes (the whole selection when `ids` is left out) and selects the copies. */
  | { type: "DUPLICATE_NODES"; ids?: string[] }
  /** Moves the nodes (with what is under them) next to or inside `targetId`: a drag and drop in the Scene tree. */
  | { type: "MOVE_NODES"; ids: string[]; targetId: string; position: DropPosition }
  /** Folds or unfolds a node's children in the Scene tree. */
  | { type: "TOGGLE_COLLAPSED"; id: string }
  /** Folds every node that has children (the scene root stays open), or unfolds them all. */
  | { type: "COLLAPSE_ALL" }
  | { type: "EXPAND_ALL" }
  | { type: "SET_WORKSPACE"; workspace: WorkspaceId }
  | { type: "SET_BOTTOM_TAB"; tab: BottomTabId }
  | { type: "SET_SCREEN_FILTER"; filter: ScreenFilter }
  | { type: "SET_TWO_D_SCREEN"; screen: ScreenId }
  | { type: "SET_FPS_TARGET"; fps: FpsTarget }
  | { type: "SET_TOOL"; tool: EditorTool }
  | { type: "MOVE_NODE"; id: string; x: number; y: number; at: number }
  | { type: "SET_TRANSFORM_3D"; id: string; field: Transform3DField; value: Vector3; at: number }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "END_EDIT_GESTURE" }
  | { type: "TOGGLE_VISIBLE"; id: string }
  | { type: "SET_MESH_SOURCE"; id: string; source: MeshSource }
  | { type: "IMPORT_MESH"; mesh: ImportedMesh; warnings: string[] }
  | { type: "IMPORT_RIGGED_MODEL"; model: RiggedModel; warnings: string[] }
  | { type: "SET_MESH_TEXTURE"; id: string; textureId: string | null }
  | { type: "SET_MESH_COLOR"; id: string; color: string | null; at: number }
  | { type: "SET_MESH_UNLIT"; id: string; unlit: boolean }
  | { type: "SET_MESH_CULL"; id: string; cull: MeshCullMode }
  | { type: "SET_MESH_ALPHA"; id: string; alpha: number; at: number }
  | { type: "SET_LIGHT_INTENSITY"; id: string; intensity: number; at: number }
  | { type: "SET_CAMERA_CURRENT"; id: string; current: boolean }
  | { type: "RENAME_NODE"; id: string; name: string; at: number }
  | { type: "ANIM_CREATE"; playerId: string; id: string }
  | { type: "ANIM_RENAME"; playerId: string; animationId: string; name: string; at: number }
  | { type: "ANIM_DELETE"; playerId: string; animationId: string }
  | { type: "ANIM_SET"; playerId: string; animationId: string; change: { length?: number; loop?: boolean }; at: number }
  | { type: "ANIM_PLAYER_SET"; playerId: string; change: { autoplay?: string | null; speed?: number }; at: number }
  | { type: "ANIM_ADD_TRACK"; playerId: string; animationId: string; trackId: string; nodeId: string; property: AnimationProperty }
  | { type: "ANIM_DELETE_TRACK"; playerId: string; animationId: string; trackId: string }
  | { type: "ANIM_ADD_KEY"; playerId: string; animationId: string; trackId: string; time: number }
  | { type: "ANIM_SET_KEY"; playerId: string; animationId: string; trackId: string; time: number; change: { time?: number; value?: AnimationValue }; at: number }
  | { type: "ANIM_DELETE_KEY"; playerId: string; animationId: string; trackId: string; time: number }
  | { type: "ANIM_UI"; change: Partial<AnimationUi> }
  | { type: "IMPORT_TEXTURE"; nodeId: string; texture: ImportedTexture; warnings: string[] }
  | { type: "SET_NODE_SCREEN"; id: string; screen: ScreenId }
  | { type: "SET_SPRITE_IMAGE"; id: string; spriteId: string | null }
  | { type: "IMPORT_SPRITE"; nodeId: string | null; sprite: ImportedSprite; warnings: string[] }
  | { type: "SCENE_SWITCH"; id: string }
  | { type: "SCENE_ADD"; id: string; name: string }
  | { type: "SCENE_RENAME"; id: string; name: string; at: number }
  | { type: "SCENE_DELETE"; id: string }
  | { type: "SCENE_DUPLICATE"; id: string; newId: string }
  | { type: "SCENE_SET_START"; id: string }
  /** Puts an instance of another scene in the scene being edited, under `parentId` (the selected node when absent). */
  | { type: "SCENE_INSTANTIATE"; sceneId: string; parentId?: string }
  | { type: "SPRITE_ANIM_ADD"; id: string }
  | { type: "SPRITE_ANIM_SET"; id: string; index: number; change: SpriteAnimationChange; at: number }
  | { type: "SPRITE_ANIM_REMOVE"; id: string; index: number }
  | { type: "SPRITE_ANIM_START"; id: string; name: string | null }
  | { type: "SET_AUDIO_SOUND"; id: string; soundId: string | null }
  | { type: "SET_AUDIO_PLAYER"; id: string; change: AudioPlayerChange; at: number }
  | { type: "AUDIO_CLIP_CREATE"; playerId: string; id: string }
  | { type: "AUDIO_CLIP_RENAME"; playerId: string; clipId: string; name: string; at: number }
  | { type: "AUDIO_CLIP_DELETE"; playerId: string; clipId: string }
  | { type: "AUDIO_CLIP_SET"; playerId: string; clipId: string; change: AudioClipChange; at: number }
  | { type: "SET_COLLISION_SHAPE"; id: string; change: CollisionShapeChange; at: number }
  | { type: "SET_TILE_MAP"; id: string; change: TileMapChange }
  | { type: "PAINT_TILE"; id: string; column: number; row: number; tile: number }
  | { type: "SET_TILE_SOLID"; id: string; tile: number; value: boolean }
  | { type: "SET_SPRITE_TRANSFORM"; id: string; change: SpriteTransformChange; at: number }
  | { type: "SET_TOUCH_AREA_2D"; id: string; change: TouchArea2DChange; at: number }
  | { type: "SET_LABEL"; id: string; change: LabelChange; at: number }
  | { type: "SET_TOUCH_AREA_3D"; id: string; change: TouchArea3DChange; at: number }
  | { type: "IMPORT_SOUND"; nodeId: string | null; sound: ImportedSound; warnings: string[] }
  | { type: "SELECT_SCRIPT"; id: string | null }
  | { type: "CREATE_SCRIPT"; attachTo: string | null; id: string }
  | { type: "RENAME_SCRIPT"; id: string; name: string; at: number }
  | { type: "DELETE_SCRIPT"; id: string }
  | { type: "SET_SCRIPT_SOURCE"; id: string; source: string; at: number }
  | { type: "ATTACH_SCRIPT"; nodeId: string; scriptId: string | null }
  | { type: "ADD_NODE"; kind: SceneNodeKind }
  | { type: "DELETE_NODE"; id: string }
  | { type: "DUPLICATE_NODE"; id: string }
  | { type: "PROJECT_SAVED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_OPENED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_CREATED"; filePath: string; project: ProjectSnapshot }
  | { type: "PROJECT_CLOSED" }
  | { type: "LOG"; message: string };

export function createInitialState(): EditorState {
  const sceneRoot = createBlankSceneTree("2D");
  return {
    sceneRoot,
    selectedNodeId: sceneRoot.id,
    extraSelectedIds: [],
    selectionAnchorId: sceneRoot.id,
    collapsedNodeIds: [],
    activeWorkspace: "2D",
    activeBottomTab: "Output",
    screenFilter: "both",
    fpsTarget: DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget,
    activeTool: "select",
    history: EMPTY_HISTORY,
    outputLog: ["Good Stuff DS Game Maker ready."],
    project: null,
    projectFilePath: null,
    activeSceneId: DEFAULT_START_SCENE_ID,
    savedScenes: undefined,
    savedScripts: undefined,
    selectedScriptId: null,
    animationUi: EMPTY_ANIMATION_UI
  };
}

/** Loads `project` into the editor already configured for its committed mode. */
function loadProject(state: EditorState, project: ProjectSnapshot, filePath: string, logMessage: string): EditorState {
  // Ids from an earlier session (or none, for a brand-new project) mustn't collide with ones this session creates later: see ensureNodeIdsAbove.
  ensureNodeIdsAbove(flattenAllScenes(project).map((node) => node.id));
  return {
    ...state,
    sceneRoot: project.scene,
    selectedNodeId: project.scene.id,
    extraSelectedIds: [],
    selectionAnchorId: project.scene.id,
    collapsedNodeIds: [],
    activeWorkspace: project.mode,
    // A 3D project opens looking at its 3D screen.
    screenFilter: project.mode === "3D" ? project.scene.screen : screenFilterForMode(state.screenFilter, project.mode),
    project,
    projectFilePath: filePath,
    activeSceneId: listScenes(project)[0].id,
    savedScenes: listScenes(project),
    savedScripts: project.scripts,
    selectedScriptId: project.scripts?.[0]?.id ?? null,
    animationUi: EMPTY_ANIMATION_UI,
    activeBottomTab: state.activeBottomTab === "Animation" ? "Output" : state.activeBottomTab,
    outputLog: [...state.outputLog, logMessage]
  };
}

function applyAction(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "SELECT_NODE_MODIFIED": {
      // Rows that are folded away take no part in a range: it runs over what the tree shows.
      const order = visibleNodeIds(state.sceneRoot, state.collapsedNodeIds);
      if (!order.includes(action.id)) return state;
      const all = selectedNodeIdsOf(state);
      let primary: string;
      let others: string[];
      let anchor = state.selectionAnchorId;
      if (action.mode === "toggle") {
        anchor = action.id;
        if (all.includes(action.id)) {
          // Ctrl+click on a selected node takes it out; the last of the rest becomes the primary (the scene root when nothing is left).
          const rest = all.filter((id) => id !== action.id);
          primary = action.id !== state.selectedNodeId ? state.selectedNodeId : (rest[0] ?? state.sceneRoot.id); // the most recently selected of the rest
          others = rest.filter((id) => id !== primary);
        } else {
          primary = action.id;
          others = all;
        }
      } else {
        const shownAnchor = nearestVisibleId(state.sceneRoot, state.collapsedNodeIds, anchor);
        const from = order.indexOf(order.includes(shownAnchor) ? shownAnchor : state.selectedNodeId);
        const to = order.indexOf(action.id);
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        primary = action.id;
        others = range.filter((id) => id !== action.id);
      }
      const chosen = applyAction(state, { type: "SELECT_NODE", id: primary }); // the primary's own side effects (an AnimationPlayer opens its panel)
      return { ...chosen, extraSelectedIds: others, selectionAnchorId: anchor };
    }
    case "SELECT_NODE": {
      if (action.id === state.selectedNodeId && state.extraSelectedIds.length === 0) return { ...state, selectionAnchorId: action.id };
      // Selecting an AnimationPlayer starts the Animation panel on it and shows the panel. Selecting anything else ends a preview (so the viewport shows
      // the nodes' own values again) but leaves the panel as it is, so a node's values can be changed between one key and the next.
      const chosen = findSceneNode(state.sceneRoot, action.id);
      const player = chosen?.kind === "AnimationPlayer";
      return {
        ...state,
        selectedNodeId: action.id,
        extraSelectedIds: [],
        selectionAnchorId: action.id,
        animationUi: player
          ? action.id === state.animationUi.playerId
            ? { ...state.animationUi, previewTime: null, previewPlaying: false }
            : { ...EMPTY_ANIMATION_UI, playerId: action.id }
          : { ...state.animationUi, previewTime: null, previewPlaying: false },
        activeBottomTab: player ? "Animation" : state.activeBottomTab
      };
    }
    case "ANIM_UI":
      return { ...state, animationUi: { ...state.animationUi, ...action.change } };
    case "ANIM_CREATE":
      return changePlayer(state, action.playerId, (data) => ({
        ...data,
        animations: [...data.animations, { id: action.id, name: uniqueAnimationName(data.animations.map((a) => a.name)), length: 1, loop: false, tracks: [] }]
      }), { ...state.animationUi, playerId: action.playerId, animationId: action.id, trackId: null, keyTime: null, previewTime: null, previewPlaying: false });
    case "ANIM_RENAME":
      return changePlayer(state, action.playerId, (data) => {
        const name = action.name.trim();
        const current = data.animations.find((a) => a.id === action.animationId);
        if (!current || name === "" || name === current.name || data.animations.some((a) => a.id !== current.id && a.name === name)) return null;
        return { ...data, animations: data.animations.map((a) => (a.id === current.id ? { ...a, name } : a)) };
      });
    case "ANIM_DELETE":
      return changePlayer(state, action.playerId, (data) => {
        if (!data.animations.some((a) => a.id === action.animationId)) return null;
        const animations = data.animations.filter((a) => a.id !== action.animationId);
        const { autoplay, ...rest } = data;
        return { ...rest, ...(autoplay !== undefined && autoplay !== action.animationId ? { autoplay } : {}), animations };
      }, { ...EMPTY_ANIMATION_UI, playerId: action.playerId });
    case "ANIM_SET":
      return changePlayer(state, action.playerId, (data) => {
        const current = data.animations.find((a) => a.id === action.animationId);
        if (!current) return null;
        const lastKey = Math.max(0, ...current.tracks.flatMap((t) => t.keys.map((k) => k.time)));
        const length = action.change.length !== undefined && Number.isFinite(action.change.length) ? Math.max(lastKey, clampAnimationLength(action.change.length)) : current.length;
        const loop = action.change.loop ?? current.loop;
        if (length === current.length && loop === current.loop) return null;
        return { ...data, animations: data.animations.map((a) => (a.id === current.id ? { ...a, length: Math.round(length * 1000) / 1000, loop } : a)) };
      });
    case "ANIM_PLAYER_SET":
      return changePlayer(state, action.playerId, (data) => {
        const { autoplay: _drop, ...rest } = data;
        const wanted = action.change.autoplay === undefined ? data.autoplay : action.change.autoplay === null ? undefined : action.change.autoplay;
        if (wanted !== undefined && !data.animations.some((a) => a.id === wanted)) return null;
        const speed = action.change.speed !== undefined && Number.isFinite(action.change.speed) ? clampAnimationSpeed(action.change.speed) : data.speed;
        if (wanted === data.autoplay && speed === data.speed) return null;
        return { ...rest, ...(wanted !== undefined ? { autoplay: wanted } : {}), speed };
      });
    case "ANIM_ADD_TRACK": {
      const target = findSceneNode(state.sceneRoot, action.nodeId);
      if (!target || !animatableProperties(target.kind).includes(action.property)) return state;
      return changePlayer(state, action.playerId, (data) => {
        const current = data.animations.find((a) => a.id === action.animationId);
        if (!current || current.tracks.some((t) => t.nodeId === action.nodeId && t.property === action.property)) return null;
        return { ...data, animations: data.animations.map((a) => (a.id === current.id ? { ...a, tracks: [...a.tracks, { id: action.trackId, nodeId: action.nodeId, property: action.property, keys: [] }] } : a)) };
      }, { ...state.animationUi, trackId: action.trackId, keyTime: null });
    }
    case "ANIM_DELETE_TRACK":
      return changePlayer(state, action.playerId, (data) => {
        const current = data.animations.find((a) => a.id === action.animationId);
        if (!current || !current.tracks.some((t) => t.id === action.trackId)) return null;
        return { ...data, animations: data.animations.map((a) => (a.id === current.id ? { ...a, tracks: a.tracks.filter((t) => t.id !== action.trackId) } : a)) };
      }, { ...state.animationUi, trackId: null, keyTime: null });
    case "ANIM_ADD_KEY": {
      const player = findSceneNode(state.sceneRoot, action.playerId);
      const track = player ? getAnimationPlayer(player).animations.find((a) => a.id === action.animationId)?.tracks.find((t) => t.id === action.trackId) : undefined;
      const target = track ? findSceneNode(state.sceneRoot, track.nodeId) : undefined;
      if (!track || !target) return state;
      const time = Math.round(action.time * 1000) / 1000;
      return changePlayer(state, action.playerId, (data) => {
        const current = data.animations.find((a) => a.id === action.animationId)!;
        const at = Math.min(current.length, Math.max(0, time));
        const value = currentValueOf(target, track.property);
        return {
          ...data,
          animations: data.animations.map((a) =>
            a.id !== current.id
              ? a
              : {
                  ...a,
                  tracks: a.tracks.map((t) => {
                    if (t.id !== track.id) return t;
                    // A key at this very time takes the new value; otherwise a new key goes in, in time order.
                    if (t.keys.some((k) => k.time === at)) return { ...t, keys: t.keys.map((k) => (k.time === at ? { ...k, value } : k)) };
                    return { ...t, keys: insertKey(t.keys, { time: at, value }) ?? t.keys };
                  })
                }
          )
        };
      }, { ...state.animationUi, keyTime: Math.round(Math.min(Math.max(0, time), getAnimationPlayer(player!).animations.find((a) => a.id === action.animationId)!.length) * 1000) / 1000 });
    }
    case "ANIM_SET_KEY": {
      let newTime: number | null = null;
      const next = changePlayer(state, action.playerId, (data) => {
        const current = data.animations.find((a) => a.id === action.animationId);
        const track = current?.tracks.find((t) => t.id === action.trackId);
        const key = track?.keys.find((k) => k.time === action.time);
        if (!current || !track || !key) return null;
        let time = key.time;
        if (action.change.time !== undefined && Number.isFinite(action.change.time)) time = Math.round(Math.min(current.length, Math.max(0, action.change.time)) * 1000) / 1000;
        if (time !== key.time && track.keys.some((k) => k.time === time)) return null; // another key already has that time
        let value = key.value;
        if (action.change.value !== undefined) {
          if (!isValueForProperty(track.property, action.change.value)) return null;
          value = action.change.value;
          if (track.property === "volume") value = clampVolume(value as number);
          if (track.property === "pitch") value = clampPitch(value as number);
        }
        if (time === key.time && value === key.value) return null;
        newTime = time;
        const changed = { time, value };
        return {
          ...data,
          animations: data.animations.map((a) =>
            a.id !== current.id
              ? a
              : { ...a, tracks: a.tracks.map((t) => (t.id !== track.id ? t : { ...t, keys: t.keys.map((k) => (k.time === key.time ? changed : k)).sort((x, y) => x.time - y.time) })) }
          )
        };
      });
      return next === state || newTime === null ? next : { ...next, animationUi: { ...next.animationUi, keyTime: newTime } };
    }
    case "ANIM_DELETE_KEY":
      return changePlayer(state, action.playerId, (data) => {
        const current = data.animations.find((a) => a.id === action.animationId);
        const track = current?.tracks.find((t) => t.id === action.trackId);
        if (!current || !track || !track.keys.some((k) => k.time === action.time)) return null;
        return { ...data, animations: data.animations.map((a) => (a.id !== current.id ? a : { ...a, tracks: a.tracks.map((t) => (t.id !== track.id ? t : { ...t, keys: t.keys.filter((k) => k.time !== action.time) })) })) };
      }, { ...state.animationUi, keyTime: null });
    case "SET_WORKSPACE":
      // A project's mode is permanent: never switch to the other mode's viewport tab.
      if (!state.project || !workspacesForMode(state.project.mode).includes(action.workspace)) return state;
      return { ...state, activeWorkspace: action.workspace };
    case "SET_BOTTOM_TAB":
      return { ...state, activeBottomTab: action.tab };
    case "SET_TWO_D_SCREEN": {
      // Which screen the 3D engine drives is kept in the scene root's screen (see core's screen-layout.ts), so this is a scene edit: it is saved, undone and
      // redone with the scene. Only a 3D project has a 2D screen to place.
      if (!state.project || state.project.mode !== "3D") return state;
      const threeD = otherScreen(action.screen);
      const sceneRoot = withThreeDScreen(state.sceneRoot, threeD);
      if (sceneRoot === state.sceneRoot) return state;
      return { ...state, sceneRoot, screenFilter: threeD, outputLog: [...state.outputLog, `2D screen is now the ${action.screen} screen; the 3D engine drives the ${threeD} one.`] };
    }
    case "SET_SCREEN_FILTER":
      return {
        ...state,
        screenFilter: state.project ? screenFilterForMode(action.filter, state.project.mode) : action.filter
      };
    case "SET_FPS_TARGET":
      return { ...state, fpsTarget: action.fps };
    case "SET_TOOL":
      return state.activeTool === action.tool ? state : { ...state, activeTool: action.tool };
    case "MOVE_NODE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      // Setting a position to what it already is is not an edit: no undo step, no "unsaved changes".
      if (!target || (target.position.x === action.x && target.position.y === action.y)) return state;
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({
          ...node,
          position: { x: action.x, y: action.y }
        }))
      };
    }
    case "SET_TRANSFORM_3D": {
      const current = findSceneNode(state.sceneRoot, action.id)?.transform3D?.[action.field];
      if (!current || (current.x === action.value.x && current.y === action.value.y && current.z === action.value.z)) return state;
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) =>
          node.transform3D ? { ...node, transform3D: { ...node.transform3D, [action.field]: action.value } } : node
        )
      };
    }
    case "SET_MESH_SOURCE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target?.mesh) return state;
      const next: MeshInstance3DData =
        "importedMeshId" in action.source
          ? { importedMeshId: action.source.importedMeshId, triangleCount: 0 }
          : { primitive: action.source.primitive, triangleCount: getPrimitiveTriangleCount(action.source.primitive) };
      // A model the project does not have cannot be chosen; choosing what is already chosen changes nothing,
      // so it does not make the project look edited.
      const geometry = resolveMeshGeometry(next, state.project?.meshes);
      if (!geometry || meshSourceKey(target.mesh) === meshSourceKey(next)) return state;
      // A texture needs texture coordinates: a model without any can't keep the one the mesh had.
      const keepsTexture = target.mesh.textureId !== undefined && geometry.uvs !== undefined;
      const chosen: MeshInstance3DData = {
        ...next,
        triangleCount: geometry.triangleCount,
        ...(keepsTexture ? { textureId: target.mesh.textureId } : {})
      };
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, mesh: chosen }))
      };
    }
    case "RENAME_NODE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      const name = action.name.trim();
      if (!target || name === "" || name === target.name) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, name })) };
    }
    case "SET_LIGHT_INTENSITY": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target || target.kind !== "DirectionalLight3D") return state;
      const intensity = Math.min(1, Math.max(0, action.intensity));
      // Setting the value it already has (including 100% on a light that never had one saved) isn't an edit.
      if (getLightIntensity(target) === intensity) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, light: { intensity } })) };
    }
    case "SET_CAMERA_CURRENT": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target || target.kind !== "Camera3D") return state;
      if (!action.current) {
        // Unchecking just clears this camera's own explicit mark; it falls back to "current" again only if it's
        // the first Camera3D left in the scene's tree (isCurrentCamera). A camera that was never explicitly
        // marked (only current by that fallback) has nothing to clear. Nothing else in the scene changes.
        if (target.camera?.current !== true) return state;
        const { camera: _cleared, ...rest } = target;
        return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, () => rest) };
      }
      // Already current, explicitly or by the same fallback: checking it again is a no-op.
      const camerasInScene = flattenSceneTreeInOrder(state.sceneRoot).filter((node) => node.kind === "Camera3D");
      if (isCurrentCamera(target, camerasInScene)) return state;
      // Checking it marks the target current and unmarks whichever other Camera3D in this scene had it. A
      // camera in another scene is untouched -- each scene picks its own active camera independently.
      const setCurrent = (node: SceneNode): SceneNode => {
        const children = node.children.map(setCurrent);
        if (node.id === action.id) return { ...node, children, camera: { current: true } };
        if (node.kind === "Camera3D" && node.camera?.current === true) {
          const { camera: _cleared, ...rest } = node;
          return { ...rest, children };
        }
        return { ...node, children };
      };
      return { ...state, sceneRoot: setCurrent(state.sceneRoot) };
    }
    case "SET_MESH_COLOR": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target?.mesh) return state;
      // Only a "#rrggbb" (or null for the default), kept to the 32 levels a channel the DS has, so what is stored is what it draws.
      const levels = action.color === null ? null : parseMeshColor(action.color);
      if (action.color !== null && !levels) return state;
      const next = levels ? meshColorFromLevels(levels) : null;
      if ((target.mesh.color ?? null) === next) return state;
      const { color: _cleared, ...withoutColor } = target.mesh;
      const chosen: MeshInstance3DData = next === null ? withoutColor : { ...withoutColor, color: next };
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, mesh: chosen })) };
    }
    case "SET_MESH_UNLIT": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target?.mesh || (target.mesh.unlit ?? false) === action.unlit) return state;
      const { unlit: _cleared, ...withoutUnlit } = target.mesh;
      const chosen: MeshInstance3DData = action.unlit ? { ...withoutUnlit, unlit: true } : withoutUnlit;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, mesh: chosen })) };
    }
    case "SET_MESH_CULL": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target?.mesh || (target.mesh.cull ?? "none") === action.cull) return state;
      const { cull: _cleared, ...withoutCull } = target.mesh;
      const chosen: MeshInstance3DData = action.cull === "none" ? withoutCull : { ...withoutCull, cull: action.cull };
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, mesh: chosen })) };
    }
    case "SET_MESH_ALPHA": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target?.mesh) return state;
      const opacity = Math.min(1, Math.max(0, action.alpha));
      if ((target.mesh.alpha ?? 1) === opacity) return state;
      const { alpha: _cleared, ...withoutAlpha } = target.mesh;
      const chosen: MeshInstance3DData = opacity === 1 ? withoutAlpha : { ...withoutAlpha, alpha: opacity };
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, mesh: chosen })) };
    }
    case "SET_MESH_TEXTURE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (!target?.mesh || (target.mesh.textureId ?? null) === action.textureId) return state;
      if (action.textureId !== null) {
        // Only a texture the project has, on a mesh whose geometry has texture coordinates to place it with.
        if (!state.project?.textures?.some((texture) => texture.id === action.textureId)) return state;
        if (!resolveMeshGeometry(target.mesh, state.project.meshes)?.uvs) return state;
      }
      const { textureId: _cleared, ...withoutTexture } = target.mesh;
      const chosen: MeshInstance3DData = action.textureId === null ? withoutTexture : { ...withoutTexture, textureId: action.textureId };
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, mesh: chosen })) };
    }
    case "IMPORT_TEXTURE": {
      const target = findSceneNode(state.sceneRoot, action.nodeId);
      if (!state.project || state.project.mode !== "3D" || !target?.mesh) return state;
      if (!resolveMeshGeometry(target.mesh, state.project.meshes)?.uvs) return state;
      const { textureId: _replaced, ...withoutTexture } = target.mesh;
      const chosen: MeshInstance3DData = { ...withoutTexture, textureId: action.texture.id };
      const { name, width, height } = action.texture;
      return {
        ...state,
        // The texture goes into the project and onto the mesh in one step, so the project can never hold a mesh
        // that names a texture it doesn't have.
        project: { ...state.project, textures: [...(state.project.textures ?? []), action.texture] },
        sceneRoot: updateSceneNode(state.sceneRoot, action.nodeId, (node) => ({ ...node, mesh: chosen })),
        outputLog: [
          ...state.outputLog,
          `Imported texture "${name}" (${width} x ${height}, ${getTextureByteSize(action.texture)} bytes of texture memory) onto "${target.name}".`,
          ...action.warnings.map((warning) => `Warning: ${warning}`)
        ]
      };
    }
    case "SET_NODE_SCREEN": {
      // Only in a 2D project, where both screens are 2D and each node says which one it is on. (In a 3D project the screens follow from what
      // draws a node; see screen-layout.ts.) The scene root stays where it is.
      const target = findSceneNode(state.sceneRoot, action.id);
      if (state.project?.mode !== "2D" || !target || target.id === state.sceneRoot.id || target.screen === action.screen) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, screen: action.screen })) };
    }
    case "SET_SPRITE_IMAGE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if ((target?.kind !== "Sprite2D" && target?.kind !== "AnimatedSprite2D") || (target.spriteId ?? null) === action.spriteId) return state;
      // Only an image the project has can be chosen.
      if (action.spriteId !== null && !state.project?.sprites?.some((sprite) => sprite.id === action.spriteId)) return state;
      const sheet = action.spriteId === null ? undefined : state.project?.sprites?.find((sprite) => sprite.id === action.spriteId);
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => {
          const { spriteId: _cleared, ...withoutImage } = node;
          const changed = action.spriteId === null ? withoutImage : { ...withoutImage, spriteId: action.spriteId };
          return node.kind === "AnimatedSprite2D" ? fitAnimationsToSheet(changed, sheet) : changed;
        })
      };
    }
    case "IMPORT_SPRITE": {
      if (!state.project) return state;
      const { sprite } = action;
      const target = action.nodeId === null ? undefined : findSceneNode(state.sceneRoot, action.nodeId);
      const details = `${sprite.width} x ${sprite.height}, ${getSpriteByteSize(sprite)} bytes of sprite memory`;
      const warnings = action.warnings.map((warning) => `Warning: ${warning}`);
      // The image goes into the project and onto the sprite in one step, so the project can never hold a sprite that
      // names an image it doesn't have.
      const sprites = [...(state.project.sprites ?? []), sprite];
      const frames = getSpriteFrames(sprite);
      if (target?.kind === "TileMap") {
        // A tile sheet replaces the TileMap's own, same as a sprite sheet does for an AnimatedSprite2D -- its cell grid and
        // solid flags (which count sheet frames, not cells) are left as they are, so repainting after a sheet change keeps
        // whatever was there.
        return {
          ...state,
          project: { ...state.project, sprites },
          sceneRoot: updateSceneNode(state.sceneRoot, target.id, (node) => ({ ...node, tileMap: { ...getTileMap(node), spriteId: sprite.id } })),
          outputLog: [...state.outputLog, `Imported tile sheet "${sprite.name}" (${details}, ${frames.count} tiles) onto "${target.name}".`, ...warnings]
        };
      }
      if (target?.kind === "Sprite2D" || target?.kind === "AnimatedSprite2D") {
        return {
          ...state,
          project: { ...state.project, sprites },
          sceneRoot: updateSceneNode(state.sceneRoot, target.id, (node) => {
            const withSheet = { ...node, spriteId: sprite.id };
            return node.kind === "AnimatedSprite2D" ? withDefaultAnimation(fitAnimationsToSheet(withSheet, sprite), frames.count) : withSheet;
          }),
          outputLog: [...state.outputLog, `Imported sprite ${frames.count > 1 ? "sheet" : "image"} "${sprite.name}" (${details}) onto "${target.name}".`, ...warnings]
        };
      }
      // No sprite is selected: the image arrives as a new Sprite2D in the middle of the screen, under the selected node.
      const parent = findSceneNode(state.sceneRoot, state.selectedNodeId) ?? state.sceneRoot;
      const name = uniqueNodeName(sprite.name, parent.children.map((child) => child.name));
      // A sheet of several frames arrives as an AnimatedSprite2D playing all its frames; a picture as a Sprite2D.
      const kind = frames.count > 1 ? "AnimatedSprite2D" : "Sprite2D";
      const created = createSceneNode({
        name,
        kind,
        screen: screenOfNewNode(state, kind, parent),
        position: { x: DS_HARDWARE_PROFILE.screens.width / 2, y: DS_HARDWARE_PROFILE.screens.height / 2 }
      });
      created.spriteId = sprite.id;
      const newNode = kind === "AnimatedSprite2D" ? withDefaultAnimation(created, frames.count) : created;
      return {
        ...state,
        project: { ...state.project, sprites },
        sceneRoot: updateSceneNode(state.sceneRoot, parent.id, (node) => ({ ...node, children: [...node.children, newNode] })),
        selectedNodeId: newNode.id,
        outputLog: [...state.outputLog, `Imported sprite ${frames.count > 1 ? "sheet" : "image"} "${sprite.name}" (${details}) as node "${name}".`, ...warnings]
      };
    }
    case "SCENE_SWITCH": {
      if (!state.project || action.id === state.activeSceneId) return state;
      const entries = currentSceneEntries(state);
      if (!entries.some((entry) => entry.id === action.id)) return state;
      return withScenes(state, entries, action.id);
    }
    case "SCENE_ADD": {
      if (!state.project) return state;
      const entries = currentSceneEntries(state);
      if (entries.some((entry) => entry.id === action.id)) return state;
      const name = uniqueSceneName(entries.map((entry) => entry.name), action.name);
      const scene = { ...createBlankSceneTree(state.project.mode), name };
      return withScenes(state, [...entries, { id: action.id, name, scene, isStart: false }], action.id);
    }
    case "SCENE_RENAME": {
      if (!state.project) return state;
      const entries = currentSceneEntries(state);
      const name = action.name.trim();
      const target = entries.find((entry) => entry.id === action.id);
      // A name a script can call it by: not empty, and not another scene's.
      if (!target || name === "" || name === target.name || entries.some((entry) => entry.id !== action.id && entry.name === name)) return state;
      return withScenes(state, entries.map((entry) => (entry.id === action.id ? { ...entry, name } : entry)), state.activeSceneId);
    }
    case "SCENE_DELETE": {
      if (!state.project) return state;
      const entries = currentSceneEntries(state);
      const target = entries.find((entry) => entry.id === action.id);
      if (!target || entries.length < 2) return state; // a project always has a scene
      const rest = entries.filter((entry) => entry.id !== action.id);
      // The starting scene going hands the start to the first scene left; the scene being edited going opens the starting scene.
      const withStart = target.isStart ? rest.map((entry, i) => ({ ...entry, isStart: i === 0 })) : rest;
      const active = action.id === state.activeSceneId ? withStart.find((entry) => entry.isStart)!.id : state.activeSceneId;
      return withScenes(state, withStart, active);
    }
    case "SCENE_DUPLICATE": {
      if (!state.project) return state;
      const entries = currentSceneEntries(state);
      const source = entries.find((entry) => entry.id === action.id);
      if (!source || entries.some((entry) => entry.id === action.newId)) return state;
      const name = uniqueSceneName(entries.map((entry) => entry.name), source.name);
      const copy: SceneEntry = { id: action.newId, name, scene: { ...duplicateSceneNode(source.scene), name: source.scene.name }, isStart: false };
      const at = entries.indexOf(source);
      return withScenes(state, [...entries.slice(0, at + 1), copy, ...entries.slice(at + 1)], action.newId);
    }
    case "SCENE_INSTANTIATE": {
      if (!state.project) return state;
      const entries = currentSceneEntries(state);
      const source = entries.find((entry) => entry.id === action.sceneId);
      // Not the scene being edited (it would contain itself), and not one that already contains it.
      if (!source || source.id === state.activeSceneId || instanceWouldCycle(withSceneTree(state.project, state.activeSceneId, state.sceneRoot), state.activeSceneId, source.id)) return state;
      const parent = findSceneNode(state.sceneRoot, action.parentId ?? state.selectedNodeId) ?? state.sceneRoot;
      if (parent.instanceOf !== undefined) return state; // an instance holds nothing of its own
      const name = uniqueNodeName(source.name, parent.children.map((child) => child.name));
      // It arrives where the scene's own root is, so the scene is drawn as it was made; moving it moves everything in it.
      const created = createSceneNode({ name, kind: source.scene.kind, screen: screenOfNewNode(state, source.scene.kind, parent), position: { ...source.scene.position } });
      const node: SceneNode = { ...created, ...(source.scene.transform3D ? { transform3D: source.scene.transform3D } : {}), instanceOf: source.id };
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, parent.id, (target) => ({ ...target, children: [...target.children, node] })),
        selectedNodeId: node.id,
        extraSelectedIds: [],
        selectionAnchorId: node.id,
        outputLog: [...state.outputLog, `Added an instance of the scene "${source.name}" as "${name}".`]
      };
    }
    case "SCENE_SET_START": {
      if (!state.project) return state;
      const entries = currentSceneEntries(state);
      if (!entries.some((entry) => entry.id === action.id) || entries.find((entry) => entry.isStart)!.id === action.id) return state;
      return withScenes(state, entries.map((entry) => ({ ...entry, isStart: entry.id === action.id })), state.activeSceneId);
    }
    case "SPRITE_ANIM_ADD": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "AnimatedSprite2D" && target?.kind !== "MeshInstance3D") return state;
      const data = getSpriteAnimations(target);
      const added = createSpriteAnimation(nextAnimationName(data.animations), [0]);
      // The first animation a sprite gets is the one it plays from the start (people expect the picture to move).
      const next: SpriteAnimationsData = { animations: [...data.animations, added], start: data.start ?? added.name };
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, spriteAnimations: next })) };
    }
    case "SPRITE_ANIM_SET": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "AnimatedSprite2D" && target?.kind !== "MeshInstance3D") return state;
      const data = getSpriteAnimations(target);
      const current = data.animations[action.index];
      if (!current) return state;
      const { change } = action;
      // The frames an animation may show: a sprite sheet's, or (for a model with several poses) the model's.
      const sheet = state.project?.sprites?.find((sprite) => sprite.id === target.spriteId);
      const frameCount = target.kind === "MeshInstance3D" ? (target.mesh ? getMeshFrameCount(target.mesh, state.project?.meshes) : 1) : sheet ? getSpriteFrames(sheet).count : Number.POSITIVE_INFINITY;
      let next: SpriteAnimation = current;
      if (change.name !== undefined) {
        const name = change.name.trim();
        // A name a script can call it by: not empty, and not another animation's.
        if (name === "" || (name !== current.name && data.animations.some((other) => other.name === name))) return state;
        next = { ...next, name };
      }
      if (change.frames !== undefined) {
        if (change.frames.length === 0 || change.frames.some((frame) => !Number.isInteger(frame) || frame < 0 || frame >= frameCount)) return state;
        next = { ...next, frames: [...change.frames] };
      }
      if (change.fps !== undefined && Number.isFinite(change.fps)) next = { ...next, fps: clampSpriteAnimationFps(change.fps) };
      if (change.loop !== undefined) next = { ...next, loop: change.loop };
      if (next.name === current.name && next.fps === current.fps && next.loop === current.loop && next.frames.length === current.frames.length && next.frames.every((frame, i) => frame === current.frames[i])) return state;
      const animations = data.animations.map((animation, i) => (i === action.index ? next : animation));
      const start = data.start === current.name ? next.name : data.start;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, spriteAnimations: { animations, ...(start !== undefined ? { start } : {}) } })) };
    }
    case "SPRITE_ANIM_REMOVE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "AnimatedSprite2D" && target?.kind !== "MeshInstance3D") return state;
      const data = getSpriteAnimations(target);
      const removed = data.animations[action.index];
      if (!removed) return state;
      const animations = data.animations.filter((_, i) => i !== action.index);
      const start = data.start === removed.name ? undefined : data.start;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, spriteAnimations: { animations, ...(start !== undefined ? { start } : {}) } })) };
    }
    case "SPRITE_ANIM_START": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "AnimatedSprite2D" && target?.kind !== "MeshInstance3D") return state;
      const data = getSpriteAnimations(target);
      if (action.name !== null && !data.animations.some((animation) => animation.name === action.name)) return state;
      if ((data.start ?? null) === action.name) return state;
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, spriteAnimations: { animations: data.animations, ...(action.name !== null ? { start: action.name } : {}) } }))
      };
    }
    case "SET_AUDIO_SOUND": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "AudioStreamPlayer") return state;
      const current = getAudioPlayer(target);
      if ((current.soundId ?? null) === action.soundId) return state;
      // Only a sound the project has can be chosen.
      if (action.soundId !== null && !state.project?.sounds?.some((sound) => sound.id === action.soundId)) return state;
      const { soundId: _cleared, ...withoutSound } = current;
      const audio: AudioPlayerData = action.soundId === null ? withoutSound : { ...withoutSound, soundId: action.soundId };
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, audio })) };
    }
    case "SET_AUDIO_PLAYER": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "AudioStreamPlayer") return state;
      const current = getAudioPlayer(target);
      const { change } = action;
      const audio: AudioPlayerData = {
        ...current,
        autoplay: change.autoplay ?? current.autoplay,
        volume: change.volume !== undefined && Number.isFinite(change.volume) ? clampVolume(change.volume) : current.volume,
        pitch: change.pitch !== undefined && Number.isFinite(change.pitch) ? clampPitch(change.pitch) : current.pitch,
        loop: change.loop ?? current.loop
      };
      // Setting a value to what it already is (including a default on a player that never had settings saved) isn't an edit.
      if (audio.autoplay === current.autoplay && audio.volume === current.volume && audio.pitch === current.pitch && audio.loop === current.loop) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, audio })) };
    }
    case "AUDIO_CLIP_CREATE":
      return changeAudioPlayer(state, action.playerId, (data) => {
        const clips = data.clips ?? [];
        if (clips.length >= MAX_EXTRA_AUDIO_CLIPS) return null;
        return { ...data, clips: [...clips, { id: action.id, name: uniqueAnimationName(clips.map((c) => c.name), "Sound"), volume: 1, pitch: 1, loop: false }] };
      });
    case "AUDIO_CLIP_RENAME":
      return changeAudioPlayer(state, action.playerId, (data) => {
        const clips = data.clips ?? [];
        const name = action.name.trim();
        const current = clips.find((c) => c.id === action.clipId);
        if (!current || name === "" || name === current.name || clips.some((c) => c.id !== current.id && c.name === name)) return null;
        return { ...data, clips: clips.map((c) => (c.id === current.id ? { ...c, name } : c)) };
      });
    case "AUDIO_CLIP_DELETE":
      return changeAudioPlayer(state, action.playerId, (data) => {
        const clips = data.clips ?? [];
        if (!clips.some((c) => c.id === action.clipId)) return null;
        const remaining = clips.filter((c) => c.id !== action.clipId);
        if (remaining.length > 0) return { ...data, clips: remaining };
        const { clips: _cleared, ...withoutClips } = data;
        return withoutClips;
      });
    case "AUDIO_CLIP_SET":
      return changeAudioPlayer(state, action.playerId, (data) => {
        const clips = data.clips ?? [];
        const current = clips.find((c) => c.id === action.clipId);
        if (!current) return null;
        const { change } = action;
        const { soundId: _cleared, ...withoutSound } = current;
        const withSound: AudioClip = change.soundId === undefined ? current : change.soundId === null ? withoutSound : { ...withoutSound, soundId: change.soundId };
        const next: AudioClip = {
          ...withSound,
          volume: change.volume !== undefined && Number.isFinite(change.volume) ? clampVolume(change.volume) : withSound.volume,
          pitch: change.pitch !== undefined && Number.isFinite(change.pitch) ? clampPitch(change.pitch) : withSound.pitch,
          loop: change.loop ?? withSound.loop
        };
        if (next.soundId === current.soundId && next.volume === current.volume && next.pitch === current.pitch && next.loop === current.loop) return null;
        return { ...data, clips: clips.map((c) => (c.id === current.id ? next : c)) };
      });
    case "SET_COLLISION_SHAPE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "CollisionShape3D") return state;
      const current = getCollisionShape(target);
      const { change } = action;
      const finite = (value: number | undefined, fallback: number): number => (value !== undefined && Number.isFinite(value) ? value : fallback);
      const raw: CollisionShapeData = {
        shape: change.shape ?? current.shape,
        size: { x: finite(change.size?.x, current.size.x), y: finite(change.size?.y, current.size.y), z: finite(change.size?.z, current.size.z) },
        radius: finite(change.radius, current.radius),
        height: finite(change.height, current.height),
        solid: change.solid ?? current.solid
      };
      // A radius that would leave a capsule shorter than it is wide raises the height with it; a height that is too small is raised to fit.
      const next = normalizeCollisionShape(raw);
      // Setting a value to what it already is (including a default on a shape that never had settings saved) isn't an edit.
      const same =
        next.shape === current.shape &&
        next.radius === current.radius &&
        next.height === current.height &&
        next.size.x === current.size.x &&
        next.size.y === current.size.y &&
        next.size.z === current.size.z &&
        next.solid === current.solid;
      if (same) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, collision: next })) };
    }
    case "SET_TILE_MAP": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "TileMap") return state;
      const current = getTileMap(target);
      const { change } = action;
      let next: TileMapData = current;
      if (change.spriteId !== undefined) next = { ...next, spriteId: change.spriteId === null ? undefined : change.spriteId };
      if (change.columns !== undefined || change.rows !== undefined) next = resizeTileMapGrid(next, change.columns ?? next.columns, change.rows ?? next.rows);
      if (next === current) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, tileMap: next })) };
    }
    case "PAINT_TILE": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "TileMap") return state;
      const current = getTileMap(target);
      const { column, row } = action;
      if (column < 0 || row < 0 || column >= current.columns || row >= current.rows) return state;
      const index = row * current.columns + column;
      if (current.tiles[index] === action.tile) return state;
      const tiles = [...current.tiles];
      tiles[index] = action.tile;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, tileMap: { ...current, tiles } })) };
    }
    case "SET_TILE_SOLID": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "TileMap") return state;
      const current = getTileMap(target);
      const next = setTileSolid(current, action.tile, action.value);
      if (next === current) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, tileMap: next })) };
    }
    case "SET_SPRITE_TRANSFORM": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "Sprite2D" && target?.kind !== "AnimatedSprite2D") return state;
      if (!target) return state;
      const current = getSpriteTransform(target);
      const finite = (value: number | undefined, fallback: number): number => (value !== undefined && Number.isFinite(value) ? value : fallback);
      const next = normalizeSpriteTransform({
        rotation: finite(action.change.rotation, current.rotation),
        scale: { x: finite(action.change.scaleX, current.scale.x), y: finite(action.change.scaleY, current.scale.y) }
      });
      // Setting a value it already has (a default included) isn't an edit.
      if (next.rotation === current.rotation && next.scale.x === current.scale.x && next.scale.y === current.scale.y) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, transform2D: next })) };
    }
    case "SET_LABEL": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "Label") return state;
      const current = getLabel(target);
      const next = getLabel({
        label: {
          text: action.change.text !== undefined ? action.change.text.slice(0, MAX_LABEL_CHARS) : current.text,
          color: action.change.color !== undefined && Number.isFinite(action.change.color) ? action.change.color : current.color
        }
      });
      // Setting a value to what it already is (a default on a label that never had settings saved included) isn't an edit.
      if (next.text === current.text && next.color === current.color) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, label: next })) };
    }
    case "SET_TOUCH_AREA_2D": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "TouchArea2D") return state;
      const current = getTouchArea2D(target);
      const finite = (value: number | undefined, fallback: number): number => (value !== undefined && Number.isFinite(value) ? value : fallback);
      const next = normalizeTouchArea2D({ width: finite(action.change.width, current.width), height: finite(action.change.height, current.height) });
      // Setting a value to what it already is (including a default on an area that never had settings saved) isn't an edit.
      if (next.width === current.width && next.height === current.height) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, touchArea2D: next })) };
    }
    case "SET_TOUCH_AREA_3D": {
      const target = findSceneNode(state.sceneRoot, action.id);
      if (target?.kind !== "TouchArea3D") return state;
      const current = getTouchArea3D(target);
      const { change } = action;
      const finite = (value: number | undefined, fallback: number): number => (value !== undefined && Number.isFinite(value) ? value : fallback);
      const next = normalizeTouchArea3D({
        shape: change.shape ?? current.shape,
        size: { x: finite(change.size?.x, current.size.x), y: finite(change.size?.y, current.size.y), z: finite(change.size?.z, current.size.z) },
        radius: finite(change.radius, current.radius)
      });
      if (next.shape === current.shape && next.radius === current.radius && next.size.x === current.size.x && next.size.y === current.size.y && next.size.z === current.size.z) return state;
      return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, touchArea3D: next })) };
    }
    case "IMPORT_SOUND": {
      if (!state.project) return state;
      const { sound } = action;
      const target = action.nodeId === null ? undefined : findSceneNode(state.sceneRoot, action.nodeId);
      const details = `${formatSoundTime(getSoundDurationSeconds(sound))}, ${sound.sampleRate} Hz, ${getSoundByteSize(sound)} bytes of sound memory`;
      const warnings = action.warnings.map((warning) => `Warning: ${warning}`);
      // The sound goes into the project and onto the player in one step, so the project can never hold a player that
      // names a sound it doesn't have.
      const sounds = [...(state.project.sounds ?? []), sound];
      if (target?.kind === "AudioStreamPlayer") {
        const audio: AudioPlayerData = { ...getAudioPlayer(target), soundId: sound.id };
        return {
          ...state,
          project: { ...state.project, sounds },
          sceneRoot: updateSceneNode(state.sceneRoot, target.id, (node) => ({ ...node, audio })),
          outputLog: [...state.outputLog, `Imported sound "${sound.name}" (${details}) onto "${target.name}".`, ...warnings]
        };
      }
      const parent = findSceneNode(state.sceneRoot, state.selectedNodeId) ?? state.sceneRoot;
      const name = uniqueNodeName(sound.name, parent.children.map((child) => child.name));
      const newNode = createSceneNode({ name, kind: "AudioStreamPlayer", screen: screenOfNewNode(state, "AudioStreamPlayer", parent) });
      newNode.audio = { ...DEFAULT_AUDIO_PLAYER, soundId: sound.id };
      return {
        ...state,
        project: { ...state.project, sounds },
        sceneRoot: updateSceneNode(state.sceneRoot, parent.id, (node) => ({ ...node, children: [...node.children, newNode] })),
        selectedNodeId: newNode.id,
        outputLog: [...state.outputLog, `Imported sound "${sound.name}" (${details}) as node "${name}".`, ...warnings]
      };
    }
    case "SELECT_SCRIPT":
      return state.selectedScriptId === action.id ? state : { ...state, selectedScriptId: action.id };
    case "CREATE_SCRIPT": {
      if (!state.project) return state;
      const scripts = state.project.scripts ?? [];
      const script: ProjectScript = { id: action.id, name: uniqueScriptName(scripts), source: NEW_SCRIPT_SOURCE };
      const target = action.attachTo === null ? undefined : findSceneNode(state.sceneRoot, action.attachTo);
      return {
        ...state,
        project: { ...state.project, scripts: [...scripts, script] },
        sceneRoot: target ? updateSceneNode(state.sceneRoot, target.id, (node) => ({ ...node, scriptId: script.id })) : state.sceneRoot,
        selectedScriptId: script.id,
        outputLog: [...state.outputLog, `Created script "${script.name}"${target ? ` and attached it to "${target.name}"` : ""}.`]
      };
    }
    case "RENAME_SCRIPT": {
      const scripts = state.project?.scripts;
      const name = action.name.trim();
      const current = scripts?.find((script) => script.id === action.id);
      if (!state.project || !scripts || !current || name === "" || current.name === name) return state;
      return { ...state, project: { ...state.project, scripts: scripts.map((script) => (script.id === action.id ? { ...script, name } : script)) } };
    }
    case "SET_SCRIPT_SOURCE": {
      const scripts = state.project?.scripts;
      const current = scripts?.find((script) => script.id === action.id);
      if (!state.project || !scripts || !current || current.source === action.source) return state;
      return { ...state, project: { ...state.project, scripts: scripts.map((script) => (script.id === action.id ? { ...script, source: action.source } : script)) } };
    }
    case "DELETE_SCRIPT": {
      const scripts = state.project?.scripts;
      const doomed = scripts?.find((script) => script.id === action.id);
      if (!state.project || !scripts || !doomed) return state;
      const remaining = scripts.filter((script) => script.id !== action.id);
      // Every node that used it is left with no script. (Nodes and branches that didn't use it keep their identity.)
      const detach = (node: SceneNode): SceneNode => {
        const children = node.children.map(detach);
        const changedChildren = children.some((child, i) => child !== node.children[i]);
        if (node.scriptId !== action.id && !changedChildren) return node;
        const { scriptId: _removed, ...rest } = node;
        return node.scriptId === action.id ? { ...rest, children } : { ...node, children };
      };
      const { scripts: _scripts, ...withoutScripts } = state.project;
      return {
        ...state,
        project: remaining.length > 0 ? { ...withoutScripts, scripts: remaining } : withoutScripts,
        sceneRoot: detach(state.sceneRoot),
        selectedScriptId: state.selectedScriptId === action.id ? (remaining[0]?.id ?? null) : state.selectedScriptId,
        outputLog: [...state.outputLog, `Deleted script "${doomed.name}".`]
      };
    }
    case "ATTACH_SCRIPT": {
      const target = findSceneNode(state.sceneRoot, action.nodeId);
      if (!target || (target.scriptId ?? null) === action.scriptId) return state;
      if (action.scriptId !== null && !state.project?.scripts?.some((script) => script.id === action.scriptId)) return state;
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.nodeId, (node) => {
          const { scriptId: _old, ...rest } = node;
          return action.scriptId === null ? rest : { ...rest, scriptId: action.scriptId };
        })
      };
    }
    case "IMPORT_RIGGED_MODEL": {
      if (!state.project || state.project.mode !== "3D") return state;
      const parent = findSceneNode(state.sceneRoot, state.selectedNodeId) ?? state.sceneRoot;
      const root = { ...action.model.root, name: uniqueNodeName(action.model.root.name, parent.children.map((child) => child.name)) };
      const { model } = action;
      return {
        ...state,
        // The models and the nodes that use them go in together, so the project never holds a mesh that names a model it doesn't have.
        project: { ...state.project, meshes: [...(state.project.meshes ?? []), ...model.meshes] },
        sceneRoot: updateSceneNode(state.sceneRoot, parent.id, (node) => ({ ...node, children: [...node.children, root] })),
        selectedNodeId: root.id,
        outputLog: [
          ...state.outputLog,
          `Imported rigged model "${root.name}": ${model.boneCount} bones, ${model.triangleCount} triangles${model.clipNames.length > 0 ? `, animations: ${model.clipNames.map((name) => `"${name}"`).join(", ")} (in its AnimationPlayer)` : ""}.`,
          ...action.warnings.map((warning) => `Warning: ${warning}`)
        ]
      };
    }
    case "IMPORT_MESH": {
      if (!state.project || state.project.mode !== "3D") return state;
      const parent = findSceneNode(state.sceneRoot, state.selectedNodeId) ?? state.sceneRoot;
      const name = uniqueNodeName(
        action.mesh.name,
        parent.children.map((child) => child.name)
      );
      const triangles = getImportedTriangleCount(action.mesh);
      const newNode = createSceneNode({ name, kind: "MeshInstance3D", screen: screenOfNewNode(state, "MeshInstance3D", parent) });
      newNode.mesh = { importedMeshId: action.mesh.id, triangleCount: triangles };
      return {
        ...state,
        // The model goes into the project and the mesh that uses it into the scene in one step, so the
        // project can never hold a mesh that names a model it does not have.
        project: { ...state.project, meshes: [...(state.project.meshes ?? []), action.mesh] },
        sceneRoot: updateSceneNode(state.sceneRoot, parent.id, (node) => ({
          ...node,
          children: [...node.children, newNode]
        })),
        selectedNodeId: newNode.id,
        outputLog: [
          ...state.outputLog,
          `Imported model "${action.mesh.name}" (${triangles} triangles${getImportedFrameCount(action.mesh) > 1 ? `, ${getImportedFrameCount(action.mesh)} poses` : ""}) as node "${name}".`,
          ...action.warnings.map((warning) => `Warning: ${warning}`)
        ]
      };
    }
    case "TOGGLE_VISIBLE":
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, action.id, (node) => ({ ...node, visible: !node.visible }))
      };
    case "ADD_NODE": {
      if (!state.project || !isNodeKindAllowedInMode(action.kind, state.project.mode)) return state;
      const selected = findSceneNode(state.sceneRoot, state.selectedNodeId) ?? state.sceneRoot;
      // In a 3D project a 2D node isn't put under a 3D node (or the other way round): it goes under the root instead.
      const parent = state.project.mode === "3D" && isTwoDVisualKind(action.kind) !== isTwoDVisualKind(selected.kind) && !isEngineIndependent(action.kind) && !isEngineIndependent(selected.kind) && selected.id !== state.sceneRoot.id ? state.sceneRoot : selected;
      const name = uniqueNodeName(
        action.kind,
        parent.children.map((child) => child.name)
      );
      const newNode = createSceneNode({
        name,
        kind: action.kind,
        screen: screenOfNewNode(state, action.kind, parent),
        // A directional light shines along its local -Z, which lights very little of a typical scene. A new one starts
        // angled down and to the side so it does something useful straight away.
        ...(action.kind === "DirectionalLight3D" ? { transform3D: { rotation: { ...NEW_DIRECTIONAL_LIGHT_ROTATION } } } : {})
      });
      return {
        ...state,
        sceneRoot: updateSceneNode(state.sceneRoot, parent.id, (node) => ({
          ...node,
          children: [...node.children, newNode]
        })),
        selectedNodeId: newNode.id,
        // A new AnimationPlayer opens the Animation panel on itself, as selecting one does.
        ...(newNode.kind === "AnimationPlayer" ? { activeBottomTab: "Animation" as const, animationUi: { ...EMPTY_ANIMATION_UI, playerId: newNode.id } } : { animationUi: { ...state.animationUi, previewTime: null, previewPlaying: false } }),
        outputLog: [...state.outputLog, `Added ${action.kind} node "${name}".`]
      };
    }
    case "DELETE_NODE": {
      if (action.id === state.sceneRoot.id) return state;
      const node = findSceneNode(state.sceneRoot, action.id);
      if (!node) return state;
      let sceneRoot = removeSceneNode(state.sceneRoot, action.id);
      const removedIds = new Set(flattenSceneTree(node).map((n) => n.id));
      for (const player of flattenSceneTree(sceneRoot)) {
        const animations = player.animation?.animations;
        if (!animations) continue;
        const cleaned = withoutTracksFor(animations, removedIds);
        if (cleaned.some((a, i) => a !== animations[i])) sceneRoot = updateSceneNode(sceneRoot, player.id, (n) => ({ ...n, animation: { ...n.animation, animations: cleaned } }));
      }
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
      // The copy gets a name of its own among its siblings ("JengaBlock" -> "JengaBlock2", then "JengaBlock3"); what is under it keeps its names, as in
      // Godot (names only have to differ within one parent), so a script on every copy finds its own `$Child`.
      const parent = flattenSceneTree(state.sceneRoot).find((candidate) => candidate.children.some((child) => child.id === action.id));
      const clone = { ...duplicateSceneNode(node), name: copyName(node.name, parent?.children.map((child) => child.name) ?? []) };
      return {
        ...state,
        sceneRoot: insertNodeAfterSibling(state.sceneRoot, action.id, clone),
        selectedNodeId: clone.id,
        outputLog: [...state.outputLog, `Duplicated node "${node.name}" as "${clone.name}".`]
      };
    }
    case "TOGGLE_COLLAPSED": {
      const node = findSceneNode(state.sceneRoot, action.id);
      if (!node || node.children.length === 0) return state;
      if (state.collapsedNodeIds.includes(action.id)) return { ...state, collapsedNodeIds: state.collapsedNodeIds.filter((id) => id !== action.id) };
      // Folding hides the selected nodes inside it: they leave the selection, and the folded node is selected instead when it was the primary that went.
      const hidden = new Set(flattenSceneTree(node).map((n) => n.id));
      hidden.delete(node.id);
      const folded = { ...state, collapsedNodeIds: [...state.collapsedNodeIds, action.id] };
      const selection = selectedNodeIdsOf(state);
      if (!selection.some((id) => hidden.has(id))) return folded;
      const stays = selection.filter((id) => !hidden.has(id));
      if (hidden.has(state.selectedNodeId)) {
        const chosen = applyAction(folded, { type: "SELECT_NODE", id: action.id });
        return { ...chosen, extraSelectedIds: stays, selectionAnchorId: action.id };
      }
      return { ...folded, extraSelectedIds: stays.filter((id) => id !== state.selectedNodeId), selectionAnchorId: hidden.has(state.selectionAnchorId) ? action.id : state.selectionAnchorId };
    }
    case "COLLAPSE_ALL": {
      const parents = flattenSceneTree(state.sceneRoot).filter((node) => node.children.length > 0 && node.id !== state.sceneRoot.id).map((node) => node.id);
      if (parents.length === 0) return state;
      // Everything inside a folded node is hidden, so the selection comes up to the nearest node that is shown.
      const folded = { ...state, collapsedNodeIds: parents };
      const shown = (id: string): string => nearestVisibleId(state.sceneRoot, parents, id);
      const primary = shown(state.selectedNodeId);
      const chosen = primary === state.selectedNodeId ? folded : applyAction(folded, { type: "SELECT_NODE", id: primary });
      return { ...chosen, extraSelectedIds: [...new Set(state.extraSelectedIds.map(shown))].filter((id) => id !== primary), selectionAnchorId: shown(state.selectionAnchorId) };
    }
    case "EXPAND_ALL":
      return state.collapsedNodeIds.length === 0 ? state : { ...state, collapsedNodeIds: [] };
    case "DELETE_NODES": {
      const nodes = topMostNodes(state.sceneRoot, action.ids ?? selectedNodeIdsOf(state));
      if (nodes.length === 0) return state;
      let next = state;
      for (const node of nodes) next = applyAction(next, { type: "DELETE_NODE", id: node.id });
      return {
        ...next,
        selectedNodeId: findSceneNode(next.sceneRoot, next.selectedNodeId) ? next.selectedNodeId : next.sceneRoot.id,
        outputLog: [...state.outputLog, nodes.length === 1 ? `Deleted node "${nodes[0].name}".` : `Deleted ${nodes.length} nodes.`]
      };
    }
    case "DUPLICATE_NODES": {
      const nodes = topMostNodes(state.sceneRoot, action.ids ?? selectedNodeIdsOf(state));
      if (nodes.length === 0) return state;
      let next = state;
      const copies: string[] = [];
      for (const node of nodes) {
        next = applyAction(next, { type: "DUPLICATE_NODE", id: node.id });
        copies.push(next.selectedNodeId);
      }
      const primary = copies[copies.length - 1];
      return {
        ...next,
        selectedNodeId: primary,
        extraSelectedIds: copies.slice(0, -1),
        selectionAnchorId: primary,
        outputLog: [...state.outputLog, nodes.length === 1 ? `Duplicated node "${nodes[0].name}".` : `Duplicated ${nodes.length} nodes.`]
      };
    }
    case "MOVE_NODES": {
      const moved = movedTree(state, action.ids, action.targetId, action.position);
      if (!moved) return state;
      const nodes = topMostNodes(state.sceneRoot, action.ids);
      const target = findSceneNode(state.sceneRoot, action.targetId);
      const where = action.position === "inside" ? "into" : action.position === "before" ? "before" : "after";
      return {
        ...state,
        sceneRoot: moved,
        // Dropped into a folded node: it opens, so the moved nodes are seen where they went.
        collapsedNodeIds: action.position === "inside" ? state.collapsedNodeIds.filter((id) => id !== action.targetId) : state.collapsedNodeIds,
        outputLog: [...state.outputLog, `Moved ${nodes.length === 1 ? `"${nodes[0].name}"` : `${nodes.length} nodes`} ${where} "${target?.name ?? ""}".`]
      };
    }
    case "PROJECT_SAVED":
      return {
        ...state,
        project: action.project,
        projectFilePath: action.filePath,
        savedScenes: listScenes(action.project),
        savedScripts: action.project.scripts,
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
        savedScripts: undefined,
        selectedScriptId: null,
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
  /** In a 3D project: which screen holds the 2D nodes (the 3D engine drives the other). One undoable step. */
  setTwoDScreen: (screen: ScreenId) => void;
  setFpsTarget: (fps: FpsTarget) => void;
  setActiveTool: (tool: EditorTool) => void;
  /** Animations (requirements/animation/TASK.animation-timeline-editor.md). `playerId` is an AnimationPlayer's node id; times are seconds. */
  animations: {
    create: (playerId: string) => string;
    rename: (playerId: string, animationId: string, name: string) => void;
    remove: (playerId: string, animationId: string) => void;
    set: (playerId: string, animationId: string, change: { length?: number; loop?: boolean }) => void;
    setPlayer: (playerId: string, change: { autoplay?: string | null; speed?: number }) => void;
    addTrack: (playerId: string, animationId: string, nodeId: string, property: AnimationProperty) => string;
    removeTrack: (playerId: string, animationId: string, trackId: string) => void;
    addKey: (playerId: string, animationId: string, trackId: string, time: number) => void;
    setKey: (playerId: string, animationId: string, trackId: string, time: number, change: { time?: number; value?: AnimationValue }) => void;
    removeKey: (playerId: string, animationId: string, trackId: string, time: number) => void;
    /** Changes the panel's own state: what is selected and the preview (not edits). */
    ui: (change: Partial<AnimationUi>) => void;
  };
  /** An AudioStreamPlayer's own named clips (requirements/audio/STORY.named-audio-clips.md), playable with `play("name")` alongside its own sound. At most `MAX_EXTRA_AUDIO_CLIPS`; `create` is a no-op past that (and returns an id regardless, which then names nothing). */
  audioClips: {
    create: (playerId: string) => string;
    rename: (playerId: string, clipId: string, name: string) => void;
    remove: (playerId: string, clipId: string) => void;
    set: (playerId: string, clipId: string, change: AudioClipChange) => void;
  };
  /** Renames a node (the name is trimmed; an empty one is ignored). Typing is one undo step per pause. */
  renameNode: (id: string, name: string) => void;
  /** Sets a DirectionalLight3D's intensity, 0..1 (the brightness of a white light). One undo step per drag. No-op for other nodes. */
  setLightIntensity: (id: string, intensity: number) => void;
  /**
   * Marks or unmarks a Camera3D as the scene's active camera. Marking it unmarks whichever other Camera3D in
   * the same scene had it; unmarking it just clears its own mark (it falls back to "current" again only if it's
   * the first Camera3D left in the scene's tree). No-op for a node that isn't a Camera3D, or setting what it
   * already explicitly is.
   */
  setCameraCurrent: (id: string, current: boolean) => void;
  /** Undoes the last scene edit (Ctrl+Z). Does nothing when there's nothing to undo. */
  undo: () => void;
  /** Redoes the last undone edit (Ctrl+Shift+Z). */
  redo: () => void;
  /** Says a drag has ended, so the next edit of the same thing is a new undo step. */
  endEditGesture: () => void;
  /** What Undo / Redo would do ("Delete Camera3D"), or null when there's nothing to undo / redo. */
  undoLabel: string | null;
  redoLabel: string | null;
  moveNode: (id: string, x: number, y: number) => void;
  setTransform3D: (id: string, field: Transform3DField, value: Vector3) => void;
  toggleVisible: (id: string) => void;
  /** Changes what a MeshInstance3D is made of (and so its triangle cost). No-op for other nodes, the same source, or a model the project lacks. */
  setMeshSource: (id: string, source: MeshSource) => void;
  /** Chooses a mesh's texture from the project's imported ones, or none (null). No-op for a mesh that can't take one. */
  setMeshTexture: (id: string, textureId: string | null) => void;
  /** Sets a mesh's color ("#rrggbb", or null for the default). Dragging in a color picker is one undo step per pause. No-op for a node without a mesh. */
  setMeshColor: (id: string, color: string | null) => void;
  /** Sets whether a mesh ignores the scene's lights and always shows its own color at full brightness. No-op for a node without a mesh. */
  setMeshUnlit: (id: string, unlit: boolean) => void;
  /** Sets which side(s) of a mesh's triangles are drawn ("none": both, the default). No-op for a node without a mesh. */
  setMeshCull: (id: string, cull: MeshCullMode) => void;
  /** Sets a mesh's opacity, 0..1 (1, fully opaque, is the default). Dragging the slider is one undo step per pause. No-op for a node without a mesh. */
  setMeshAlpha: (id: string, alpha: number) => void;
  /**
   * Asks for a .png file and, if the DS can use it, adds it to the project and puts it on the mesh `nodeId`. A refused
   * file changes nothing and is explained in the Output log; cancelling does nothing.
   */
  importTexture: (nodeId: string) => Promise<void>;
  /** Puts a node of a 2D project on the top or the bottom screen. No-op in a 3D project (its screens follow from what draws each node) and for the scene root. */
  setNodeScreen: (id: string, screen: ScreenId) => void;
  /** Chooses a Sprite2D's image from the project's imported ones, or none (null). No-op for other nodes and images the project lacks. */
  setSpriteImage: (id: string, spriteId: string | null) => void;
  /**
   * Asks for a .png file and, if the DS has a sprite for its size, adds it to the project and puts it on the Sprite2D `nodeId`
   * (with null, or a node that isn't a Sprite2D, as a new Sprite2D in the middle of the screen). A refused file changes nothing and
   * is explained in the Output log; cancelling does nothing.
   */
  importSprite: (nodeId: string | null, frame?: { width: number; height: number }) => Promise<void>;
  /** Adds an animation (named "anim", "anim2", ...; showing frame 0) to the AnimatedSprite2D `id`; the first one it gets is the one it starts with. */
  addSpriteAnimation: (id: string) => void;
  /** Changes an animation of an AnimatedSprite2D (name, frames, speed or looping); a name that is empty or already taken, or a frame the sheet doesn't have, is ignored. */
  setSpriteAnimation: (id: string, index: number, change: SpriteAnimationChange) => void;
  removeSpriteAnimation: (id: string, index: number) => void;
  /** Which animation an AnimatedSprite2D plays from the start (null: none). */
  setSpriteStartAnimation: (id: string, name: string | null) => void;
  /** Scenes (requirements/scene-designer/STORY.multiple-scenes.md). Switching the scene being edited is not an edit; the rest are (and can be undone). */
  switchScene: (id: string) => void;
  /** Adds an empty scene (named `name`, or with a number after it when that is taken) and opens it. */
  addScene: (name?: string) => string;
  renameScene: (id: string, name: string) => void;
  /** Deletes a scene (never the last one); the starting scene going makes the first left the start. */
  deleteScene: (id: string) => void;
  /** Copies a scene (every node with a new id) next to the original and opens the copy. */
  duplicateScene: (id: string) => string;
  /** Makes a scene the one the game starts in. */
  setStartScene: (id: string) => void;
  /** Adds an instance of another scene to the scene being edited (under `parentId`, or the selected node): a node that shows that whole scene, changing when the scene does. */
  instantiateScene: (sceneId: string, parentId?: string) => void;
  /** Opens a script in the Script tab (not an edit). */
  selectScript: (id: string | null) => void;
  /** Creates a script (with the stubs), opens it, and attaches it to `attachTo` when given. Returns the new script's id. */
  createScript: (attachTo?: string | null) => string;
  /** Renames a script; an empty name is ignored. */
  renameScript: (id: string, name: string) => void;
  /** Deletes a script and detaches it from every node that used it. */
  deleteScript: (id: string) => void;
  /** Replaces a script's source (typing merges into one undo step per pause). */
  setScriptSource: (id: string, source: string) => void;
  /** Attaches a script to a node, or detaches it (null). */
  attachScript: (nodeId: string, scriptId: string | null) => void;
  /** Shows the Script tab with `id` open. */
  openScript: (id: string) => void;
  /** Chooses an audio player's sound from the project's imported ones, or none (null). No-op for other nodes. */
  setAudioSound: (id: string, soundId: string | null) => void;
  /** Changes an audio player's autoplay, volume, pitch or loop. A slider drag is one undo step. No-op for other nodes. */
  setAudioPlayer: (id: string, change: AudioPlayerChange) => void;
  /** Changes a CollisionShape3D's shape, box size, radius or height. Typing in a field is one undo step per pause. No-op for other nodes. */
  setCollisionShape: (id: string, change: CollisionShapeChange) => void;
  /** Changes a TileMap's sheet or grid size (resizing keeps each existing cell at its column/row). No-op for other nodes. */
  setTileMap: (id: string, change: TileMapChange) => void;
  /** Paints one cell of a TileMap's grid with a tile index (a sheet frame), or -1 to clear it. No-op for other nodes. */
  paintTile: (id: string, column: number, row: number, tile: number) => void;
  /** Marks one of a TileMap's sheet frames solid ground (or not) for tile_solid(). No-op for other nodes. */
  setTileSolidAt: (id: string, tile: number, value: boolean) => void;
  /** Changes a Sprite2D's rotation and scale. Typing in a field is one undo step per pause. No-op for other nodes. */
  setSpriteTransform: (id: string, change: SpriteTransformChange) => void;
  /** Changes a TouchArea2D's size in pixels / a TouchArea3D's shape and size. Typing in a field is one undo step per pause. No-op for other nodes. */
  setTouchArea2D: (id: string, change: TouchArea2DChange) => void;
  /** Changes a Label's text and/or color. Typing in the text is one undo step per pause. No-op for other nodes. */
  setLabel: (id: string, change: LabelChange) => void;
  setTouchArea3D: (id: string, change: TouchArea3DChange) => void;
  /**
   * Asks for a sound file (.wav, .mp3 or .ogg), converts it to what the DS plays and adds it to the project: onto the audio
   * player `nodeId` when that is one, otherwise as a new AudioStreamPlayer under the selected node. A refused file changes
   * nothing and is explained in the Output log; cancelling does nothing.
   */
  importSound: (nodeId: string | null) => Promise<void>;
  /**
   * Asks for an .obj file and, if it is acceptable, adds a MeshInstance3D that uses it under the selected
   * node. A refused file changes nothing and is explained in the Output log; cancelling does nothing.
   */
  importModel: (poses?: boolean) => Promise<void>;
  /** Scene > Import Rigged Model: a .glb or .gltf with a skeleton becomes a tree of bone nodes with the mesh under its bones and the file's clips in an AnimationPlayer. */
  importRiggedModel: () => Promise<void>;
  addNode: (kind: SceneNodeKind) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  /** Ctrl+click (toggle) or Shift+click (range) a node in the Scene tree. */
  selectNodeModified: (id: string, mode: "toggle" | "range") => void;
  /** Delete / duplicate every selected node (the scene root excepted). */
  deleteSelected: () => void;
  duplicateSelected: () => void;
  /** Drag and drop in the Scene tree: moves these nodes next to or inside `targetId` (no-op when that isn't allowed). */
  moveNodes: (ids: string[], targetId: string, position: DropPosition) => void;
  /** Fold or unfold a node's children in the Scene tree; fold or unfold them all. */
  toggleCollapsed: (id: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  /** Creates a new project of `mode` (permanent), asks where to save it, and opens it. */
  createProject: (name: string, mode: ProjectMode, twoDScreen?: ScreenId) => Promise<ProjectActionResult>;
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

/** The actions that edit the scene, and so become undo steps. Everything else (view state, file operations) doesn't. */
function describeEdit(action: Action, before: EditorState): { label: string; mergeKey?: string; at?: number } | null {
  const nameOf = (id: string): string => findSceneNode(before.sceneRoot, id)?.name ?? "node";
  switch (action.type) {
    case "MOVE_NODE":
      return { label: `Move ${nameOf(action.id)}`, mergeKey: `move:${action.id}`, at: action.at };
    case "SET_TRANSFORM_3D": {
      const verb = action.field === "position" ? "Move" : action.field === "rotation" ? "Rotate" : "Scale";
      return { label: `${verb} ${nameOf(action.id)}`, mergeKey: `transform:${action.id}:${action.field}`, at: action.at };
    }
    case "TOGGLE_VISIBLE":
      return { label: `Toggle visibility of ${nameOf(action.id)}` };
    case "SET_MESH_SOURCE":
      return { label: `Change mesh of ${nameOf(action.id)}` };
    case "IMPORT_RIGGED_MODEL":
      return { label: `Import rigged model ${action.model.root.name}` };
    case "IMPORT_MESH":
      return { label: `Import ${action.mesh.name}` };
    case "SET_MESH_TEXTURE":
      return { label: `Change texture of ${nameOf(action.id)}` };
    case "SET_MESH_COLOR":
      return { label: `Change color of ${nameOf(action.id)}`, mergeKey: `mesh-color:${action.id}`, at: action.at };
    case "SET_MESH_UNLIT":
      return { label: `${action.unlit ? "Make" : "Stop making"} ${nameOf(action.id)} unlit` };
    case "SET_MESH_CULL":
      return { label: `Change face culling of ${nameOf(action.id)}` };
    case "SET_MESH_ALPHA":
      return { label: `Change opacity of ${nameOf(action.id)}`, mergeKey: `mesh-alpha:${action.id}`, at: action.at };
    case "ANIM_CREATE":
      return { label: `Add animation to ${nameOf(action.playerId)}` };
    case "ANIM_RENAME":
      return { label: `Rename animation of ${nameOf(action.playerId)}`, mergeKey: `anim-rename:${action.animationId}`, at: action.at };
    case "ANIM_DELETE":
      return { label: `Delete animation of ${nameOf(action.playerId)}` };
    case "ANIM_SET":
      return action.change.loop !== undefined
        ? { label: `Turn loop ${action.change.loop ? "on" : "off"} for an animation of ${nameOf(action.playerId)}` }
        : { label: `Change animation length of ${nameOf(action.playerId)}`, mergeKey: `anim-length:${action.animationId}`, at: action.at };
    case "ANIM_PLAYER_SET":
      return action.change.speed !== undefined
        ? { label: `Change speed of ${nameOf(action.playerId)}`, mergeKey: `anim-speed:${action.playerId}`, at: action.at }
        : { label: `Change autoplay of ${nameOf(action.playerId)}` };
    case "ANIM_ADD_TRACK":
      return { label: `Add ${action.property} track for ${nameOf(action.nodeId)}` };
    case "ANIM_DELETE_TRACK":
      return { label: `Delete animation track of ${nameOf(action.playerId)}` };
    case "ANIM_ADD_KEY":
      return { label: `Add key to ${nameOf(action.playerId)}` };
    case "ANIM_SET_KEY":
      return { label: `Edit key of ${nameOf(action.playerId)}`, mergeKey: `anim-key:${action.trackId}`, at: action.at };
    case "ANIM_DELETE_KEY":
      return { label: `Delete key of ${nameOf(action.playerId)}` };
    case "RENAME_NODE":
      return { label: `Rename ${nameOf(action.id)}`, mergeKey: `rename-node:${action.id}`, at: action.at };
    case "SET_LIGHT_INTENSITY":
      return { label: `Change intensity of ${nameOf(action.id)}`, mergeKey: `light:${action.id}`, at: action.at };
    case "SET_CAMERA_CURRENT":
      return { label: action.current ? `Make ${nameOf(action.id)} the active camera` : `Unmark ${nameOf(action.id)} as the active camera` };
    case "IMPORT_TEXTURE":
      return { label: `Import texture ${action.texture.name}` };
    case "SET_NODE_SCREEN":
      return { label: `Move ${nameOf(action.id)} to the ${action.screen} screen` };
    case "SET_SPRITE_IMAGE":
      return { label: `Change image of ${nameOf(action.id)}` };
    case "IMPORT_SPRITE":
      return { label: `Import sprite ${getSpriteFrames(action.sprite).count > 1 ? "sheet" : "image"} ${action.sprite.name}` };
    case "SCENE_ADD":
      return { label: `Add scene ${action.name}` };
    case "SCENE_RENAME":
      return { label: "Rename scene", mergeKey: `scene-name:${action.id}`, at: action.at };
    case "SCENE_DELETE":
      return { label: "Delete scene" };
    case "SCENE_DUPLICATE":
      return { label: "Duplicate scene" };
    case "SCENE_SET_START":
      return { label: "Change the starting scene" };
    case "SCENE_INSTANTIATE":
      return { label: `Instantiate scene ${before.project ? (listScenes(before.project).find((entry) => entry.id === action.sceneId)?.name ?? "") : ""}`.trim() };
    case "SPRITE_ANIM_ADD":
      return { label: `Add animation to ${nameOf(action.id)}` };
    case "SPRITE_ANIM_SET": {
      const { change } = action;
      const field = change.name !== undefined ? "name" : change.frames !== undefined ? "frames" : change.fps !== undefined ? "speed" : "looping";
      return { label: `Change ${field} of an animation of ${nameOf(action.id)}`, mergeKey: `sprite-anim:${action.id}:${action.index}:${field}`, at: action.at };
    }
    case "SPRITE_ANIM_REMOVE":
      return { label: `Remove animation from ${nameOf(action.id)}` };
    case "SPRITE_ANIM_START":
      return { label: `Change starting animation of ${nameOf(action.id)}` };
    case "IMPORT_SOUND":
      return { label: `Import sound ${action.sound.name}` };
    case "CREATE_SCRIPT":
      return { label: "Create script" };
    case "RENAME_SCRIPT":
      return { label: "Rename script", mergeKey: `script-name:${action.id}`, at: action.at };
    case "SET_SCRIPT_SOURCE": {
      const name = before.project?.scripts?.find((script) => script.id === action.id)?.name ?? "script";
      return { label: `Edit ${name}`, mergeKey: `script-source:${action.id}`, at: action.at };
    }
    case "DELETE_SCRIPT":
      return { label: `Delete script ${before.project?.scripts?.find((script) => script.id === action.id)?.name ?? ""}`.trim() };
    case "ATTACH_SCRIPT":
      return { label: action.scriptId === null ? `Detach script from ${nameOf(action.nodeId)}` : `Attach script to ${nameOf(action.nodeId)}` };
    case "SET_AUDIO_SOUND":
      return { label: `Change sound of ${nameOf(action.id)}` };
    case "SET_COLLISION_SHAPE": {
      const { change } = action;
      const name = nameOf(action.id);
      if (change.shape !== undefined) return { label: `Change shape of ${name} to ${change.shape}` };
      if (change.solid !== undefined) return { label: `Turn solid ${change.solid ? "on" : "off"} for ${name}` };
      // Typing in a field is one step per pause, per field.
      const field = change.radius !== undefined ? "radius" : change.height !== undefined ? "height" : "size";
      return { label: `Change ${field} of ${name}`, mergeKey: `collision:${action.id}:${field}`, at: action.at };
    }
    case "SET_SPRITE_TRANSFORM": {
      const field = action.change.rotation !== undefined ? "rotation" : action.change.scaleX !== undefined ? "scale X" : "scale Y";
      return { label: `Change ${field} of ${nameOf(action.id)}`, mergeKey: `sprite-transform:${action.id}:${field}`, at: action.at };
    }
    case "SET_TILE_MAP": {
      const name = nameOf(action.id);
      if (action.change.spriteId !== undefined) return { label: `Change tile sheet of ${name}` };
      return { label: `Resize ${name}` };
    }
    case "PAINT_TILE":
      return { label: `Paint a tile on ${nameOf(action.id)}` };
    case "SET_TILE_SOLID":
      return { label: `Turn solid ${action.value ? "on" : "off"} for a tile of ${nameOf(action.id)}` };
    case "SET_LABEL":
      // Typing is one undo step per pause; a color is one step per choice.
      if (action.change.text !== undefined) return { label: `Change text of ${nameOf(action.id)}`, mergeKey: `label-text:${action.id}`, at: action.at };
      return { label: `Change color of ${nameOf(action.id)}` };
    case "SET_TOUCH_AREA_2D": {
      const field = action.change.width !== undefined ? "width" : "height";
      return { label: `Change ${field} of ${nameOf(action.id)}`, mergeKey: `touch2d:${action.id}:${field}`, at: action.at };
    }
    case "SET_TOUCH_AREA_3D": {
      const { change } = action;
      const name = nameOf(action.id);
      if (change.shape !== undefined) return { label: `Change shape of ${name} to ${change.shape}` };
      const field = change.radius !== undefined ? "radius" : "size";
      return { label: `Change ${field} of ${name}`, mergeKey: `touch3d:${action.id}:${field}`, at: action.at };
    }
    case "SET_AUDIO_PLAYER": {
      const { change } = action;
      // A slider is one step per drag; a checkbox is one step per click.
      if (change.volume !== undefined) return { label: `Change volume of ${nameOf(action.id)}`, mergeKey: `audio:${action.id}:volume`, at: action.at };
      if (change.pitch !== undefined) return { label: `Change pitch of ${nameOf(action.id)}`, mergeKey: `audio:${action.id}:pitch`, at: action.at };
      if (change.autoplay !== undefined) return { label: `Turn autoplay ${change.autoplay ? "on" : "off"} for ${nameOf(action.id)}` };
      return { label: `Turn loop ${change.loop ? "on" : "off"} for ${nameOf(action.id)}` };
    }
    case "AUDIO_CLIP_CREATE":
      return { label: `Add a named sound to ${nameOf(action.playerId)}` };
    case "AUDIO_CLIP_RENAME":
      return { label: `Rename a sound of ${nameOf(action.playerId)}`, mergeKey: `audio-clip-rename:${action.clipId}`, at: action.at };
    case "AUDIO_CLIP_DELETE":
      return { label: `Delete a sound of ${nameOf(action.playerId)}` };
    case "AUDIO_CLIP_SET": {
      const { change } = action;
      if (change.volume !== undefined) return { label: `Change volume of a sound of ${nameOf(action.playerId)}`, mergeKey: `audio-clip:${action.clipId}:volume`, at: action.at };
      if (change.pitch !== undefined) return { label: `Change pitch of a sound of ${nameOf(action.playerId)}`, mergeKey: `audio-clip:${action.clipId}:pitch`, at: action.at };
      if (change.soundId !== undefined) return { label: `Change the sound of a named clip of ${nameOf(action.playerId)}` };
      return { label: `Turn loop ${change.loop ? "on" : "off"} for a sound of ${nameOf(action.playerId)}` };
    }
    case "SET_TWO_D_SCREEN":
      return { label: `Put the 2D screen on the ${action.screen}` };
    case "ADD_NODE":
      return { label: `Add ${action.kind}` };
    case "DELETE_NODE":
      return { label: `Delete ${nameOf(action.id)}` };
    case "DUPLICATE_NODE":
      return { label: `Duplicate ${nameOf(action.id)}` };
    case "DELETE_NODES":
    case "DUPLICATE_NODES": {
      const count = topMostNodes(before.sceneRoot, action.ids ?? selectedNodeIdsOf(before)).length;
      const verb = action.type === "DELETE_NODES" ? "Delete" : "Duplicate";
      return { label: count === 1 ? `${verb} ${nameOf(topMostNodes(before.sceneRoot, action.ids ?? selectedNodeIdsOf(before))[0].id)}` : `${verb} ${count} nodes` };
    }
    case "MOVE_NODES": {
      const nodes = topMostNodes(before.sceneRoot, action.ids);
      return { label: nodes.length === 1 ? `Move ${nodes[0].name}` : `Move ${nodes.length} nodes` };
    }
    default:
      return null;
  }
}

/**
 * Applies `change` to an AnimationPlayer's data (null = nothing to change) and returns the new state; `animationUi` replaces the panel's selection when given.
 * Only an AnimationPlayer has animations; anything else is left alone.
 */
function changePlayer(state: EditorState, playerId: string, change: (data: AnimationPlayerData) => AnimationPlayerData | null, animationUi?: AnimationUi): EditorState {
  const player = findSceneNode(state.sceneRoot, playerId);
  if (!player || player.kind !== "AnimationPlayer") return state;
  const data = getAnimationPlayer(player);
  const next = change(data);
  if (!next) return state;
  return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, playerId, (node) => ({ ...node, animation: next })), animationUi: animationUi ?? state.animationUi };
}

/** Like `changePlayer`, for an AudioStreamPlayer's named clips (`STORY.named-audio-clips.md`). `change` returns null for a no-op. */
function changeAudioPlayer(state: EditorState, playerId: string, change: (data: AudioPlayerData) => AudioPlayerData | null): EditorState {
  const player = findSceneNode(state.sceneRoot, playerId);
  if (!player || player.kind !== "AudioStreamPlayer") return state;
  const data = getAudioPlayer(player);
  const next = change(data);
  if (!next) return state;
  return { ...state, sceneRoot: updateSceneNode(state.sceneRoot, playerId, (node) => ({ ...node, audio: next })) };
}

/** What an undo puts back: the scene, the project's imported models, and the selection. */
function editStateOf(state: EditorState): EditState {
  return {
    sceneRoot: state.sceneRoot,
    meshes: state.project?.meshes,
    textures: state.project?.textures,
    sounds: state.project?.sounds,
    sprites: state.project?.sprites,
    scripts: state.project?.scripts,
    selectedNodeId: state.selectedNodeId,
    sceneEntries: state.project ? currentSceneEntries(state) : undefined,
    activeSceneId: state.activeSceneId
  };
}

function restore(state: EditorState, entry: EditState & { label: string }, history: EditHistory, verb: "Undid" | "Redid"): EditorState {
  let project = state.project;
  if (project && (project.meshes !== entry.meshes || project.textures !== entry.textures || project.sounds !== entry.sounds || project.sprites !== entry.sprites || project.scripts !== entry.scripts)) {
    const { meshes: _meshes, textures: _textures, sounds: _sounds, sprites: _sprites, scripts: _scripts, ...rest } = project;
    project = {
      ...rest,
      ...(entry.meshes ? { meshes: entry.meshes } : {}),
      ...(entry.textures ? { textures: entry.textures } : {}),
      ...(entry.sounds ? { sounds: entry.sounds } : {}),
      ...(entry.sprites ? { sprites: entry.sprites } : {}),
      ...(entry.scripts ? { scripts: entry.scripts } : {})
    };
  }
  // The scenes go back as they were, and the one the edit was made in is the one being edited.
  if (project && entry.sceneEntries) project = withSceneEntries(project, entry.sceneEntries);
  return {
    ...state,
    sceneRoot: entry.sceneRoot,
    activeSceneId: entry.activeSceneId ?? state.activeSceneId,
    project,
    // An undo can remove the script that is open (undoing its creation): open another, or none.
    selectedScriptId: project?.scripts?.some((script) => script.id === state.selectedScriptId) ? state.selectedScriptId : (project?.scripts?.[0]?.id ?? null),
    // Back to the selection the edit started from, unless that node isn't in the restored scene.
    selectedNodeId: findSceneNode(entry.sceneRoot, entry.selectedNodeId) ? entry.selectedNodeId : entry.sceneRoot.id,
    history,
    outputLog: [...state.outputLog, `${verb}: ${entry.label}.`]
  };
}

/**
 * The editor's reducer: `applyAction` plus undo/redo (requirements/scene-designer/TASK.undo-redo-for-scene-edits.md).
 * An action that edits the scene and actually changes it records a history step first; opening, creating or
 * closing a project starts a fresh history; saving keeps it (you can undo past a save).
 */
export function editorReducer(state: EditorState, action: Action): EditorState {
  return normalizeSelection(state, reduceWithHistory(state, action), action);
}

/**
 * The scene tree after moving `ids` next to or inside `targetId`, or null when that isn't allowed or changes nothing. In a 3D project a 2D node isn't nested under a 3D node (or
 * the other way round), as when a node is added; the players and the scene root take anything.
 */
function movedTree(state: EditorState, ids: readonly string[], targetId: string, position: DropPosition): SceneNode | null {
  const threeD = state.project?.mode === "3D";
  const canAdopt = (node: SceneNode, parent: SceneNode): boolean =>
    !threeD || parent.id === state.sceneRoot.id || isEngineIndependent(node.kind) || isEngineIndependent(parent.kind) || isTwoDVisualKind(node.kind) === isTwoDVisualKind(parent.kind);
  return moveSceneNodes(state.sceneRoot, ids, targetId, position, canAdopt);
}

/** Whether dropping `ids` at `position` relative to `targetId` would move them: what the Scene tree checks while a drag is over a row. */
export function canMoveNodes(state: EditorState, ids: readonly string[], targetId: string, position: DropPosition): boolean {
  return movedTree(state, ids, targetId, position) !== null;
}

/** The ids of the rows the Scene tree shows, in order: every node except those under a folded one. */
export function visibleNodeIds(root: SceneNode, collapsed: readonly string[]): string[] {
  const folded = new Set(collapsed);
  const ids: string[] = [];
  const visit = (node: SceneNode): void => {
    ids.push(node.id);
    if (!folded.has(node.id)) node.children.forEach(visit);
  };
  visit(root);
  return ids;
}

/** The ancestors of `id`, from the scene root down to its parent; empty for the root or a node that isn't there. */
export function ancestorIds(root: SceneNode, id: string): string[] {
  const path: string[] = [];
  const find = (node: SceneNode): boolean => {
    if (node.id === id) return true;
    path.push(node.id);
    if (node.children.some(find)) return true;
    path.pop();
    return false;
  };
  return find(root) ? path : [];
}

/** `id` itself when its row is shown, otherwise the outermost folded node above it (the row that stands for it). */
export function nearestVisibleId(root: SceneNode, collapsed: readonly string[], id: string): string {
  return ancestorIds(root, id).find((ancestor) => collapsed.includes(ancestor)) ?? id;
}

/** The primary selected node and the others selected with it, primary first. */
export function selectedNodeIdsOf(state: Pick<EditorState, "selectedNodeId" | "extraSelectedIds">): string[] {
  return [state.selectedNodeId, ...state.extraSelectedIds];
}

/**
 * Keeps the selection consistent after any action: the others selected with the primary are dropped when the primary was changed by something other than a click with
 * Ctrl or Shift (or a duplicate, which selects its copies), and never include a node that is gone, or the primary itself.
 */
function normalizeSelection(before: EditorState, after: EditorState, action: Action): EditorState {
  const keepsMany = action.type === "SELECT_NODE_MODIFIED" || action.type === "DUPLICATE_NODES" || action.type === "TOGGLE_COLLAPSED" || action.type === "COLLAPSE_ALL";
  const primaryChanged = after.selectedNodeId !== before.selectedNodeId;
  const existing = new Set(flattenSceneTree(after.sceneRoot).map((node) => node.id));
  const extras = primaryChanged && !keepsMany ? [] : after.extraSelectedIds.filter((id) => id !== after.selectedNodeId && existing.has(id));
  const anchor = primaryChanged && !keepsMany ? after.selectedNodeId : existing.has(after.selectionAnchorId) ? after.selectionAnchorId : after.selectedNodeId;
  // A node selected from somewhere else (the viewport, a new node, an undo) may be inside a folded one: unfold the way to it. Folded ids of nodes that are gone are dropped.
  const reveal = primaryChanged ? new Set(ancestorIds(after.sceneRoot, after.selectedNodeId)) : new Set<string>();
  const collapsed = after.collapsedNodeIds.filter((id) => existing.has(id) && !reveal.has(id));
  const sameCollapsed = collapsed.length === after.collapsedNodeIds.length;
  if (sameCollapsed && extras.length === after.extraSelectedIds.length && extras.every((id, i) => id === after.extraSelectedIds[i]) && anchor === after.selectionAnchorId) return after;
  return { ...after, extraSelectedIds: extras, selectionAnchorId: anchor, collapsedNodeIds: collapsed };
}

function reduceWithHistory(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "UNDO": {
      if (!state.project) return state;
      const step = undoStep(state.history, editStateOf(state));
      return step ? restore(state, step.entry, step.history, "Undid") : state;
    }
    case "REDO": {
      if (!state.project) return state;
      const step = redoStep(state.history, editStateOf(state));
      return step ? restore(state, step.entry, step.history, "Redid") : state;
    }
    case "END_EDIT_GESTURE": {
      const history = endGesture(state.history);
      return history === state.history ? state : { ...state, history };
    }
    case "PROJECT_OPENED":
    case "PROJECT_CREATED":
    case "PROJECT_CLOSED":
      return { ...applyAction(state, action), history: EMPTY_HISTORY };
    default: {
      const next = applyAction(state, action);
      const edit = describeEdit(action, state);
      const changed =
        next.sceneRoot !== state.sceneRoot ||
        next.project?.meshes !== state.project?.meshes ||
        next.project?.textures !== state.project?.textures ||
        next.project?.sounds !== state.project?.sounds ||
        next.project?.sprites !== state.project?.sprites ||
        next.project?.scripts !== state.project?.scripts ||
        next.project?.scenes !== state.project?.scenes ||
        next.project?.sceneName !== state.project?.sceneName ||
        next.project?.sceneId !== state.project?.sceneId ||
        next.activeSceneId !== state.activeSceneId;
      if (!edit || !changed) return next;
      return { ...next, history: recordEdit(state.history, editStateOf(state), edit) };
    }
  }
}

function describeFailure(result: { message?: string; issues?: string[] }): string {
  const detail = result.issues?.length ? `: ${result.issues.join("; ")}` : "";
  return `${result.message ?? "unknown error"}${detail}`;
}

const EditorStoreContext = createContext<EditorStoreValue | null>(null);

export function EditorStoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(editorReducer, undefined, createInitialState);

  // A node inside an instance is selected as the instance (its id is `<instance id>/<node id>`).
  const selectNode = useCallback((id: string) => dispatch({ type: "SELECT_NODE", id: outerNodeId(id) }), []);
  const setWorkspace = useCallback((workspace: WorkspaceId) => dispatch({ type: "SET_WORKSPACE", workspace }), []);
  const setBottomTab = useCallback((tab: BottomTabId) => dispatch({ type: "SET_BOTTOM_TAB", tab }), []);
  const setScreenFilter = useCallback((filter: ScreenFilter) => dispatch({ type: "SET_SCREEN_FILTER", filter }), []);
  const setTwoDScreen = useCallback((screen: ScreenId) => dispatch({ type: "SET_TWO_D_SCREEN", screen }), []);
  const setFpsTarget = useCallback((fps: FpsTarget) => dispatch({ type: "SET_FPS_TARGET", fps }), []);
  const setLightIntensity = useCallback(
    (id: string, intensity: number) => dispatch({ type: "SET_LIGHT_INTENSITY", id, intensity, at: Date.now() }),
    []
  );
  const setCameraCurrent = useCallback((id: string, current: boolean) => dispatch({ type: "SET_CAMERA_CURRENT", id, current }), []);
  const setActiveTool = useCallback((tool: EditorTool) => dispatch({ type: "SET_TOOL", tool }), []);
  const moveNode = useCallback((id: string, x: number, y: number) => dispatch({ type: "MOVE_NODE", id, x, y, at: Date.now() }), []);
  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);
  const endEditGesture = useCallback(() => dispatch({ type: "END_EDIT_GESTURE" }), []);
  const setTransform3D = useCallback(
    (id: string, field: Transform3DField, value: Vector3) => dispatch({ type: "SET_TRANSFORM_3D", id, field, value, at: Date.now() }),
    []
  );
  const toggleVisible = useCallback((id: string) => dispatch({ type: "TOGGLE_VISIBLE", id }), []);
  const setMeshSource = useCallback((id: string, source: MeshSource) => dispatch({ type: "SET_MESH_SOURCE", id, source }), []);
  const addNode = useCallback((kind: SceneNodeKind) => dispatch({ type: "ADD_NODE", kind }), []);
  const deleteNode = useCallback((id: string) => dispatch({ type: "DELETE_NODE", id }), []);
  const duplicateNode = useCallback((id: string) => dispatch({ type: "DUPLICATE_NODE", id }), []);
  const selectNodeModified = useCallback((id: string, mode: "toggle" | "range") => dispatch({ type: "SELECT_NODE_MODIFIED", id: outerNodeId(id), mode }), []);
  const deleteSelected = useCallback(() => dispatch({ type: "DELETE_NODES" }), []);
  const duplicateSelected = useCallback(() => dispatch({ type: "DUPLICATE_NODES" }), []);
  const toggleCollapsed = useCallback((id: string) => dispatch({ type: "TOGGLE_COLLAPSED", id }), []);
  const collapseAll = useCallback(() => dispatch({ type: "COLLAPSE_ALL" }), []);
  const expandAll = useCallback(() => dispatch({ type: "EXPAND_ALL" }), []);
  const moveNodes = useCallback((ids: string[], targetId: string, position: DropPosition) => dispatch({ type: "MOVE_NODES", ids, targetId, position }), []);
  const log = useCallback((message: string) => dispatch({ type: "LOG", message }), []);

  const createProject = useCallback(async (name: string, mode: ProjectMode, twoDScreen?: ScreenId): Promise<ProjectActionResult> => {
    const snapshot = createProjectSnapshot({ name, mode, scene: createBlankSceneTree(mode, twoDScreen) });
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
    const snapshot = savedProjectOf(state);
    const result = await window.goodstuff.project.save(state.projectFilePath, snapshot);
    if (result.outcome === "ok" && result.filePath) {
      dispatch({ type: "PROJECT_SAVED", filePath: result.filePath, project: snapshot });
      return true;
    }
    if (result.outcome === "error") {
      dispatch({ type: "LOG", message: `Save failed: ${describeFailure(result)}` });
    }
    return false;
  }, [state.project, state.projectFilePath, state.sceneRoot, state.activeSceneId]);

  const saveProjectAs = useCallback(async (): Promise<boolean> => {
    if (!state.project) return false;
    const snapshot = savedProjectOf(state);
    const result = await window.goodstuff.project.saveAs(snapshot);
    if (result.outcome === "ok" && result.filePath) {
      dispatch({ type: "PROJECT_SAVED", filePath: result.filePath, project: snapshot });
      return true;
    }
    if (result.outcome === "error") {
      dispatch({ type: "LOG", message: `Save failed: ${describeFailure(result)}` });
    }
    return false;
  }, [state.project, state.sceneRoot, state.activeSceneId]);

  const setMeshColor = useCallback((id: string, color: string | null) => dispatch({ type: "SET_MESH_COLOR", id, color, at: Date.now() }), []);
  const setMeshUnlit = useCallback((id: string, unlit: boolean) => dispatch({ type: "SET_MESH_UNLIT", id, unlit }), []);
  const setMeshCull = useCallback((id: string, cull: MeshCullMode) => dispatch({ type: "SET_MESH_CULL", id, cull }), []);
  const setMeshAlpha = useCallback((id: string, alpha: number) => dispatch({ type: "SET_MESH_ALPHA", id, alpha, at: Date.now() }), []);
  const setMeshTexture = useCallback(
    (id: string, textureId: string | null) => dispatch({ type: "SET_MESH_TEXTURE", id, textureId }),
    []
  );

  const setNodeScreen = useCallback((id: string, screen: ScreenId) => dispatch({ type: "SET_NODE_SCREEN", id, screen }), []);

  const setSpriteImage = useCallback(
    (id: string, spriteId: string | null) => dispatch({ type: "SET_SPRITE_IMAGE", id, spriteId }),
    []
  );

  const switchScene = useCallback((id: string) => dispatch({ type: "SCENE_SWITCH", id }), []);
  const addScene = useCallback((name = "Scene") => {
    const id = newSceneId();
    dispatch({ type: "SCENE_ADD", id, name });
    return id;
  }, []);
  const renameScene = useCallback((id: string, name: string) => dispatch({ type: "SCENE_RENAME", id, name, at: Date.now() }), []);
  const deleteScene = useCallback((id: string) => dispatch({ type: "SCENE_DELETE", id }), []);
  const duplicateScene = useCallback((id: string) => {
    const newId = newSceneId();
    dispatch({ type: "SCENE_DUPLICATE", id, newId });
    return newId;
  }, []);
  const instantiateScene = useCallback((sceneId: string, parentId?: string) => dispatch({ type: "SCENE_INSTANTIATE", sceneId, parentId }), []);
  const setStartScene = useCallback((id: string) => dispatch({ type: "SCENE_SET_START", id }), []);

  const addSpriteAnimation = useCallback((id: string) => dispatch({ type: "SPRITE_ANIM_ADD", id }), []);
  const setSpriteAnimation = useCallback((id: string, index: number, change: SpriteAnimationChange) => dispatch({ type: "SPRITE_ANIM_SET", id, index, change, at: Date.now() }), []);
  const removeSpriteAnimation = useCallback((id: string, index: number) => dispatch({ type: "SPRITE_ANIM_REMOVE", id, index }), []);
  const setSpriteStartAnimation = useCallback((id: string, name: string | null) => dispatch({ type: "SPRITE_ANIM_START", id, name }), []);

  const importSprite = useCallback(
    async (nodeId: string | null, frame?: { width: number; height: number }): Promise<void> => {
      if (!state.project) return;
      const result = await window.goodstuff.assets.importSprite(frame);
      if (result.outcome === "canceled") return;
      if (result.outcome === "ok" && result.sprite) {
        dispatch({ type: "IMPORT_SPRITE", nodeId, sprite: result.sprite, warnings: result.warnings });
        return;
      }
      const file = result.fileName ? ` "${result.fileName}"` : "";
      dispatch({ type: "LOG", message: `Could not import${file}:` });
      for (const error of result.errors) dispatch({ type: "LOG", message: `  ${error}` });
    },
    [state.project]
  );

  const importTexture = useCallback(
    async (nodeId: string): Promise<void> => {
      if (!state.project || state.project.mode !== "3D") return;
      const result = await window.goodstuff.assets.importTexture();
      if (result.outcome === "canceled") return;
      if (result.outcome === "ok" && result.texture) {
        dispatch({ type: "IMPORT_TEXTURE", nodeId, texture: result.texture, warnings: result.warnings });
        return;
      }
      const file = result.fileName ? ` "${result.fileName}"` : "";
      dispatch({ type: "LOG", message: `Could not import${file}:` });
      for (const error of result.errors) dispatch({ type: "LOG", message: `  ${error}` });
    },
    [state.project]
  );

  const selectScript = useCallback((id: string | null) => dispatch({ type: "SELECT_SCRIPT", id }), []);
  const createScript = useCallback((attachTo: string | null = null): string => {
    const id = crypto.randomUUID();
    dispatch({ type: "CREATE_SCRIPT", attachTo, id });
    return id;
  }, []);
  const renameScript = useCallback((id: string, name: string) => dispatch({ type: "RENAME_SCRIPT", id, name, at: Date.now() }), []);
  const deleteScript = useCallback((id: string) => dispatch({ type: "DELETE_SCRIPT", id }), []);
  const setScriptSource = useCallback((id: string, source: string) => dispatch({ type: "SET_SCRIPT_SOURCE", id, source, at: Date.now() }), []);
  const attachScript = useCallback((nodeId: string, scriptId: string | null) => dispatch({ type: "ATTACH_SCRIPT", nodeId, scriptId }), []);
  const openScript = useCallback((id: string) => {
    dispatch({ type: "SELECT_SCRIPT", id });
    dispatch({ type: "SET_WORKSPACE", workspace: "Script" });
  }, []);

  const animations = useMemo(
    () => ({
      create: (playerId: string): string => {
        const id = crypto.randomUUID();
        dispatch({ type: "ANIM_CREATE", playerId, id });
        return id;
      },
      rename: (playerId: string, animationId: string, name: string) => dispatch({ type: "ANIM_RENAME", playerId, animationId, name, at: Date.now() }),
      remove: (playerId: string, animationId: string) => dispatch({ type: "ANIM_DELETE", playerId, animationId }),
      set: (playerId: string, animationId: string, change: { length?: number; loop?: boolean }) => dispatch({ type: "ANIM_SET", playerId, animationId, change, at: Date.now() }),
      setPlayer: (playerId: string, change: { autoplay?: string | null; speed?: number }) => dispatch({ type: "ANIM_PLAYER_SET", playerId, change, at: Date.now() }),
      addTrack: (playerId: string, animationId: string, nodeId: string, property: AnimationProperty): string => {
        const trackId = crypto.randomUUID();
        dispatch({ type: "ANIM_ADD_TRACK", playerId, animationId, trackId, nodeId, property });
        return trackId;
      },
      removeTrack: (playerId: string, animationId: string, trackId: string) => dispatch({ type: "ANIM_DELETE_TRACK", playerId, animationId, trackId }),
      addKey: (playerId: string, animationId: string, trackId: string, time: number) => dispatch({ type: "ANIM_ADD_KEY", playerId, animationId, trackId, time }),
      setKey: (playerId: string, animationId: string, trackId: string, time: number, change: { time?: number; value?: AnimationValue }) =>
        dispatch({ type: "ANIM_SET_KEY", playerId, animationId, trackId, time, change, at: Date.now() }),
      removeKey: (playerId: string, animationId: string, trackId: string, time: number) => dispatch({ type: "ANIM_DELETE_KEY", playerId, animationId, trackId, time }),
      ui: (change: Partial<AnimationUi>) => dispatch({ type: "ANIM_UI", change })
    }),
    []
  );
  const renameNode = useCallback((id: string, name: string) => dispatch({ type: "RENAME_NODE", id, name, at: Date.now() }), []);
  const setAudioSound = useCallback((id: string, soundId: string | null) => dispatch({ type: "SET_AUDIO_SOUND", id, soundId }), []);
  const setAudioPlayer = useCallback(
    (id: string, change: AudioPlayerChange) => dispatch({ type: "SET_AUDIO_PLAYER", id, change, at: Date.now() }),
    []
  );
  const audioClips = useMemo(
    () => ({
      create: (playerId: string): string => {
        const id = crypto.randomUUID();
        dispatch({ type: "AUDIO_CLIP_CREATE", playerId, id });
        return id;
      },
      rename: (playerId: string, clipId: string, name: string) => dispatch({ type: "AUDIO_CLIP_RENAME", playerId, clipId, name, at: Date.now() }),
      remove: (playerId: string, clipId: string) => dispatch({ type: "AUDIO_CLIP_DELETE", playerId, clipId }),
      set: (playerId: string, clipId: string, change: AudioClipChange) => dispatch({ type: "AUDIO_CLIP_SET", playerId, clipId, change, at: Date.now() })
    }),
    []
  );
  const setSpriteTransform = useCallback((id: string, change: SpriteTransformChange) => dispatch({ type: "SET_SPRITE_TRANSFORM", id, change, at: Date.now() }), []);
  const setTouchArea2D = useCallback((id: string, change: TouchArea2DChange) => dispatch({ type: "SET_TOUCH_AREA_2D", id, change, at: Date.now() }), []);
  const setLabel = useCallback((id: string, change: LabelChange) => dispatch({ type: "SET_LABEL", id, change, at: Date.now() }), []);
  const setTouchArea3D = useCallback((id: string, change: TouchArea3DChange) => dispatch({ type: "SET_TOUCH_AREA_3D", id, change, at: Date.now() }), []);

  const setCollisionShape = useCallback(
    (id: string, change: CollisionShapeChange) => dispatch({ type: "SET_COLLISION_SHAPE", id, change, at: Date.now() }),
    []
  );

  const setTileMap = useCallback((id: string, change: TileMapChange) => dispatch({ type: "SET_TILE_MAP", id, change }), []);
  const paintTile = useCallback((id: string, column: number, row: number, tile: number) => dispatch({ type: "PAINT_TILE", id, column, row, tile }), []);
  const setTileSolidAt = useCallback((id: string, tile: number, value: boolean) => dispatch({ type: "SET_TILE_SOLID", id, tile, value }), []);

  const importSound = useCallback(
    async (nodeId: string | null): Promise<void> => {
      if (!state.project) return;
      const picked = await window.goodstuff.assets.pickSound();
      if (picked.outcome === "canceled") return;
      const file = picked.fileName ? ` "${picked.fileName}"` : "";
      const refuse = (errors: string[]): void => {
        dispatch({ type: "LOG", message: `Could not import${file}:` });
        for (const error of errors) dispatch({ type: "LOG", message: `  ${error}` });
      };
      if (picked.outcome !== "ok" || !picked.bytes) {
        refuse(picked.errors);
        return;
      }
      const converted = await decodeSoundFile(picked.bytes, picked.fileName ?? "Sound", picked.compress ?? true);
      if (!converted.ok) {
        refuse(converted.errors);
        return;
      }
      dispatch({ type: "IMPORT_SOUND", nodeId, sound: { id: crypto.randomUUID(), ...converted.sound }, warnings: converted.warnings });
    },
    [state.project]
  );

  const importModel = useCallback(async (poses?: boolean): Promise<void> => {
    if (!state.project || state.project.mode !== "3D") return;
    const result = await window.goodstuff.assets.importMesh(poses);
    if (result.outcome === "canceled") return;
    if (result.outcome === "ok" && result.mesh) {
      dispatch({ type: "IMPORT_MESH", mesh: result.mesh, warnings: result.warnings });
      return;
    }
    const file = result.fileName ? ` "${result.fileName}"` : "";
    dispatch({ type: "LOG", message: `Could not import${file}:` });
    for (const error of result.errors) dispatch({ type: "LOG", message: `  ${error}` });
  }, [state.project]);

  const importRiggedModel = useCallback(async (): Promise<void> => {
    if (!state.project || state.project.mode !== "3D") return;
    const picked = await window.goodstuff.assets.pickRiggedModel();
    if (picked.outcome === "canceled") return;
    const file = picked.fileName ? ` "${picked.fileName}"` : "";
    const fail = (errors: string[]): void => {
      dispatch({ type: "LOG", message: `Could not import${file}:` });
      for (const error of errors) dispatch({ type: "LOG", message: `  ${error}` });
    };
    if (picked.outcome !== "ok" || !picked.bytes) return fail(picked.errors);
    const read = readGltfFile(picked.bytes, picked.files);
    if (!read.ok) return fail([read.error]);
    const result = importGltf(read.input, (picked.fileName ?? "Model").replace(/\.[^.]+$/, ""));
    if (!result.ok) return fail(result.errors);
    dispatch({ type: "IMPORT_RIGGED_MODEL", model: result.model, warnings: result.warnings });
  }, [state.project]);

  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);

  const exportRom = useCallback(async (): Promise<void> => {
    if (!state.project || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const snapshot = savedProjectOf(state);
      const result = await window.goodstuff.project.exportRom(snapshot, state.projectFilePath, state.fpsTarget);
      for (const line of result.lines) dispatch({ type: "LOG", message: line });
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [state.project, state.projectFilePath, state.sceneRoot, state.fpsTarget]);

  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);

  const play = useCallback(async (): Promise<void> => {
    if (!state.project || playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    try {
      const snapshot = savedProjectOf(state);
      const result = await window.goodstuff.project.play(snapshot, state.fpsTarget);
      for (const line of result.lines) dispatch({ type: "LOG", message: line });
    } finally {
      playingRef.current = false;
      setPlaying(false);
    }
  }, [state.project, state.sceneRoot, state.fpsTarget]);

  // --- Unsaved-changes guard: one prompt for every action that would discard edits. ---
  const [unsavedPrompt, setUnsavedPrompt] = useState<UnsavedChangesPrompt | null>(null);

  const projectOpen = state.project !== null;
  const promptOpen = unsavedPrompt !== null;
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

  // --- Keyboard shortcuts (the rules are in keyboard-shortcuts.ts). One listener for the life of the provider; it reads the latest state and
  // handlers from a ref, so it is never re-attached and never sees a stale selection. ---
  const shortcutRef = useRef<{ context: ShortcutContext; run: (command: ShortcutCommand) => void } | null>(null);
  const selectedNodeForKeys = findSceneNode(state.sceneRoot, state.selectedNodeId);
  shortcutRef.current = {
    context: {
      projectOpen,
      promptOpen,
      workspace: state.activeWorkspace,
      workspaces: state.project ? workspacesForMode(state.project.mode) : [],
      // Delete and Duplicate work on the whole selection, the scene root excepted: "root" here means there is nothing but the root selected.
      selectedIsRoot: selectedNodeIdsOf(state).every((id) => id === state.sceneRoot.id),
      selectedHasPosition2D: selectedNodeForKeys !== undefined && !selectedNodeForKeys.transform3D && !isEngineIndependent(selectedNodeForKeys.kind),
      focus: "none"
    },
    run: (command) => {
      const selectedId = state.selectedNodeId;
      switch (command.type) {
        case "undo": return dispatch({ type: "UNDO" });
        case "redo": return dispatch({ type: "REDO" });
        case "save": return void saveProject();
        case "save-as": return void saveProjectAs();
        case "open": return void openProject();
        case "export-rom": return void exportRom();
        case "play": return void play();
        case "duplicate": return dispatch({ type: "DUPLICATE_NODES" });
        case "delete": return dispatch({ type: "DELETE_NODES" });
        case "select-root": return dispatch({ type: "SELECT_NODE", id: state.sceneRoot.id });
        case "workspace": return dispatch({ type: "SET_WORKSPACE", workspace: command.workspace });
        case "nudge":
          if (selectedNodeForKeys) dispatch({ type: "MOVE_NODE", id: selectedId, x: selectedNodeForKeys.position.x + command.dx, y: selectedNodeForKeys.position.y + command.dy, at: Date.now() });
          return;
        case "rename": {
          const field = document.querySelector<HTMLInputElement>('input[aria-label="Name"]');
          field?.focus();
          field?.select();
          return;
        }
      }
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const current = shortcutRef.current;
      if (!current || event.defaultPrevented) return;
      const command = resolveShortcut(event, { ...current.context, focus: classifyFocus(event.target) });
      if (!command) return;
      event.preventDefault();
      current.run(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      setTwoDScreen,
      setFpsTarget,
      setActiveTool,
      setLightIntensity,
      setCameraCurrent,
      undo,
      redo,
      endEditGesture,
      undoLabel: state.history.past.at(-1)?.label ?? null,
      redoLabel: state.history.future.at(-1)?.label ?? null,
      moveNode,
      setTransform3D,
      toggleVisible,
      setMeshSource,
      setMeshTexture,
      setMeshColor,
      setMeshUnlit,
      setMeshCull,
      setMeshAlpha,
      selectScript,
      createScript,
      renameScript,
      deleteScript,
      setScriptSource,
      attachScript,
      openScript,
      setAudioSound,
      setAudioPlayer,
      setCollisionShape,
      setTileMap,
      paintTile,
      setTileSolidAt,
      setTouchArea2D,
      setLabel,
      setSpriteTransform,
      setTouchArea3D,
      renameNode,
      animations,
      audioClips,
      importSound,
      importTexture,
      setSpriteImage,
      setNodeScreen,
      importSprite,
      addSpriteAnimation,
      setSpriteAnimation,
      removeSpriteAnimation,
      setSpriteStartAnimation,
      switchScene,
      addScene,
      renameScene,
      deleteScene,
      duplicateScene,
      setStartScene,
      instantiateScene,
      importModel,
      importRiggedModel,
      addNode,
      deleteNode,
      duplicateNode,
      selectNodeModified,
      deleteSelected,
      duplicateSelected,
      moveNodes,
      toggleCollapsed,
      collapseAll,
      expandAll,
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
      setTwoDScreen,
      setFpsTarget,
      setActiveTool,
      setLightIntensity,
      setCameraCurrent,
      undo,
      redo,
      endEditGesture,
      moveNode,
      setTransform3D,
      toggleVisible,
      setMeshSource,
      setMeshTexture,
      selectScript,
      createScript,
      renameScript,
      deleteScript,
      setScriptSource,
      attachScript,
      openScript,
      setAudioSound,
      setAudioPlayer,
      setCollisionShape,
      setTileMap,
      paintTile,
      setTileSolidAt,
      setTouchArea2D,
      setLabel,
      setSpriteTransform,
      setTouchArea3D,
      renameNode,
      animations,
      audioClips,
      importSound,
      importTexture,
      setSpriteImage,
      setNodeScreen,
      importSprite,
      addSpriteAnimation,
      setSpriteAnimation,
      removeSpriteAnimation,
      setSpriteStartAnimation,
      switchScene,
      addScene,
      renameScene,
      deleteScene,
      duplicateScene,
      setStartScene,
      instantiateScene,
      importModel,
      addNode,
      deleteNode,
      duplicateNode,
      selectNodeModified,
      deleteSelected,
      duplicateSelected,
      moveNodes,
      toggleCollapsed,
      collapseAll,
      expandAll,
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
