import type {
  AudioPlayerData,
  FpsTarget,
  ImportedMesh,
  ImportedSound,
  ImportedTexture,
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
  findSceneNode,
  flattenSceneTree,
  formatSoundTime,
  getAudioPlayer,
  getImportedTriangleCount,
  getLightIntensity,
  getPrimitiveTriangleCount,
  getSoundByteSize,
  getSoundDurationSeconds,
  getTextureByteSize,
  insertNodeAfterSibling,
  meshSourceKey,
  NEW_SCRIPT_SOURCE,
  resolveMeshGeometry,
  isNodeKindAllowedInMode,
  removeSceneNode,
  uniqueNodeName,
  uniqueScriptName,
  updateSceneNode,
  withUpdatedScene,
  DS_HARDWARE_PROFILE
} from "@goodstuff/core";
import { decodeSoundFile } from "../audio/decode-sound";
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
/** What can be edited on a collision shape: any of these at once (a box's size may name just some of its axes). */
export interface CollisionShapeChange {
  shape?: CollisionShapeKind;
  size?: Partial<{ x: number; y: number; z: number }>;
  radius?: number;
  height?: number;
  solid?: boolean;
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
  selectedNodeId: string;
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
export function hasUnsavedChanges(state: Pick<EditorState, "project" | "sceneRoot" | "savedScripts">): boolean {
  return state.project !== null && (state.sceneRoot !== state.project.scene || state.project.scripts !== state.savedScripts);
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
  | { type: "SET_MESH_TEXTURE"; id: string; textureId: string | null }
  | { type: "SET_LIGHT_INTENSITY"; id: string; intensity: number; at: number }
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
  | { type: "SET_AUDIO_SOUND"; id: string; soundId: string | null }
  | { type: "SET_AUDIO_PLAYER"; id: string; change: AudioPlayerChange; at: number }
  | { type: "SET_COLLISION_SHAPE"; id: string; change: CollisionShapeChange; at: number }
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
    activeWorkspace: "2D",
    activeBottomTab: "Output",
    screenFilter: "both",
    fpsTarget: DS_HARDWARE_PROFILE.frameRate.defaultFpsTarget,
    activeTool: "select",
    history: EMPTY_HISTORY,
    outputLog: ["Good Stuff DS Game Maker ready."],
    project: null,
    projectFilePath: null,
    savedScripts: undefined,
    selectedScriptId: null,
    animationUi: EMPTY_ANIMATION_UI
  };
}

/** Loads `project` into the editor already configured for its committed mode. */
function loadProject(state: EditorState, project: ProjectSnapshot, filePath: string, logMessage: string): EditorState {
  return {
    ...state,
    sceneRoot: project.scene,
    selectedNodeId: project.scene.id,
    activeWorkspace: project.mode,
    // A 3D project opens looking at its 3D screen.
    screenFilter: project.mode === "3D" ? project.scene.screen : screenFilterForMode(state.screenFilter, project.mode),
    project,
    projectFilePath: filePath,
    savedScripts: project.scripts,
    selectedScriptId: project.scripts?.[0]?.id ?? null,
    animationUi: EMPTY_ANIMATION_UI,
    activeBottomTab: state.activeBottomTab === "Animation" ? "Output" : state.activeBottomTab,
    outputLog: [...state.outputLog, logMessage]
  };
}

function applyAction(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "SELECT_NODE": {
      if (action.id === state.selectedNodeId) return state;
      // Selecting an AnimationPlayer starts the Animation panel on it and shows the panel. Selecting anything else ends a preview (so the viewport shows
      // the nodes' own values again) but leaves the panel as it is, so a node's values can be changed between one key and the next.
      const chosen = findSceneNode(state.sceneRoot, action.id);
      const player = chosen?.kind === "AnimationPlayer";
      return {
        ...state,
        selectedNodeId: action.id,
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
          `Imported model "${action.mesh.name}" (${triangles} triangles) as node "${name}".`,
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
  /** Renames a node (the name is trimmed; an empty one is ignored). Typing is one undo step per pause. */
  renameNode: (id: string, name: string) => void;
  /** Sets a DirectionalLight3D's intensity, 0..1 (the brightness of a white light). One undo step per drag. No-op for other nodes. */
  setLightIntensity: (id: string, intensity: number) => void;
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
  /**
   * Asks for a .png file and, if the DS can use it, adds it to the project and puts it on the mesh `nodeId`. A refused
   * file changes nothing and is explained in the Output log; cancelling does nothing.
   */
  importTexture: (nodeId: string) => Promise<void>;
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
  importModel: () => Promise<void>;
  addNode: (kind: SceneNodeKind) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
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
    case "IMPORT_MESH":
      return { label: `Import ${action.mesh.name}` };
    case "SET_MESH_TEXTURE":
      return { label: `Change texture of ${nameOf(action.id)}` };
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
    case "IMPORT_TEXTURE":
      return { label: `Import texture ${action.texture.name}` };
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
    case "SET_AUDIO_PLAYER": {
      const { change } = action;
      // A slider is one step per drag; a checkbox is one step per click.
      if (change.volume !== undefined) return { label: `Change volume of ${nameOf(action.id)}`, mergeKey: `audio:${action.id}:volume`, at: action.at };
      if (change.pitch !== undefined) return { label: `Change pitch of ${nameOf(action.id)}`, mergeKey: `audio:${action.id}:pitch`, at: action.at };
      if (change.autoplay !== undefined) return { label: `Turn autoplay ${change.autoplay ? "on" : "off"} for ${nameOf(action.id)}` };
      return { label: `Turn loop ${change.loop ? "on" : "off"} for ${nameOf(action.id)}` };
    }
    case "SET_TWO_D_SCREEN":
      return { label: `Put the 2D screen on the ${action.screen}` };
    case "ADD_NODE":
      return { label: `Add ${action.kind}` };
    case "DELETE_NODE":
      return { label: `Delete ${nameOf(action.id)}` };
    case "DUPLICATE_NODE":
      return { label: `Duplicate ${nameOf(action.id)}` };
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

/** What an undo puts back: the scene, the project's imported models, and the selection. */
function editStateOf(state: EditorState): EditState {
  return {
    sceneRoot: state.sceneRoot,
    meshes: state.project?.meshes,
    textures: state.project?.textures,
    sounds: state.project?.sounds,
    scripts: state.project?.scripts,
    selectedNodeId: state.selectedNodeId
  };
}

function restore(state: EditorState, entry: EditState & { label: string }, history: EditHistory, verb: "Undid" | "Redid"): EditorState {
  let project = state.project;
  if (project && (project.meshes !== entry.meshes || project.textures !== entry.textures || project.sounds !== entry.sounds || project.scripts !== entry.scripts)) {
    const { meshes: _meshes, textures: _textures, sounds: _sounds, scripts: _scripts, ...rest } = project;
    project = {
      ...rest,
      ...(entry.meshes ? { meshes: entry.meshes } : {}),
      ...(entry.textures ? { textures: entry.textures } : {}),
      ...(entry.sounds ? { sounds: entry.sounds } : {}),
      ...(entry.scripts ? { scripts: entry.scripts } : {})
    };
  }
  return {
    ...state,
    sceneRoot: entry.sceneRoot,
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
        next.project?.scripts !== state.project?.scripts;
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

  const selectNode = useCallback((id: string) => dispatch({ type: "SELECT_NODE", id }), []);
  const setWorkspace = useCallback((workspace: WorkspaceId) => dispatch({ type: "SET_WORKSPACE", workspace }), []);
  const setBottomTab = useCallback((tab: BottomTabId) => dispatch({ type: "SET_BOTTOM_TAB", tab }), []);
  const setScreenFilter = useCallback((filter: ScreenFilter) => dispatch({ type: "SET_SCREEN_FILTER", filter }), []);
  const setTwoDScreen = useCallback((screen: ScreenId) => dispatch({ type: "SET_TWO_D_SCREEN", screen }), []);
  const setFpsTarget = useCallback((fps: FpsTarget) => dispatch({ type: "SET_FPS_TARGET", fps }), []);
  const setLightIntensity = useCallback(
    (id: string, intensity: number) => dispatch({ type: "SET_LIGHT_INTENSITY", id, intensity, at: Date.now() }),
    []
  );
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

  const setMeshTexture = useCallback(
    (id: string, textureId: string | null) => dispatch({ type: "SET_MESH_TEXTURE", id, textureId }),
    []
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
  const setCollisionShape = useCallback(
    (id: string, change: CollisionShapeChange) => dispatch({ type: "SET_COLLISION_SHAPE", id, change, at: Date.now() }),
    []
  );

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
      const converted = await decodeSoundFile(picked.bytes, picked.fileName ?? "Sound");
      if (!converted.ok) {
        refuse(converted.errors);
        return;
      }
      dispatch({ type: "IMPORT_SOUND", nodeId, sound: { id: crypto.randomUUID(), ...converted.sound }, warnings: converted.warnings });
    },
    [state.project]
  );

  const importModel = useCallback(async (): Promise<void> => {
    if (!state.project || state.project.mode !== "3D") return;
    const result = await window.goodstuff.assets.importMesh();
    if (result.outcome === "canceled") return;
    if (result.outcome === "ok" && result.mesh) {
      dispatch({ type: "IMPORT_MESH", mesh: result.mesh, warnings: result.warnings });
      return;
    }
    const file = result.fileName ? ` "${result.fileName}"` : "";
    dispatch({ type: "LOG", message: `Could not import${file}:` });
    for (const error of result.errors) dispatch({ type: "LOG", message: `  ${error}` });
  }, [state.project]);

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

  // Ctrl+Z undoes, Ctrl+Shift+Z redoes (Cmd on a Mac). It applies even with an Inspector field focused,
  // since those fields are controlled by the editor and the browser's own text undo would fight it. Not
  // while the unsaved-changes prompt is up, and not on the startup view (no project).
  const projectOpen = state.project !== null;
  const promptOpen = unsavedPrompt !== null;
  useEffect(() => {
    if (!projectOpen || promptOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "z") return;
      // Inside the code editor Ctrl+Z is the editor's own text undo (it has its own history); the scene's undo works everywhere else.
      if (event.target instanceof Element && event.target.closest(".cm-editor")) return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "REDO" : "UNDO" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projectOpen, promptOpen]);
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
      setTwoDScreen,
      setFpsTarget,
      setActiveTool,
      setLightIntensity,
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
      renameNode,
      animations,
      importSound,
      importTexture,
      importModel,
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
      setTwoDScreen,
      setFpsTarget,
      setActiveTool,
      setLightIntensity,
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
      renameNode,
      animations,
      importSound,
      importTexture,
      importModel,
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
