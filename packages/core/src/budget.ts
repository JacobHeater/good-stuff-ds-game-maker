import { DS_HARDWARE_PROFILE } from "./hardware";
import { getPrimitiveTriangleCount } from "./primitive-geometry";
import { flattenSceneTree, OAM_CONSUMING_KINDS, type SceneNode } from "./scene-node";
import type { ScreenId } from "./index";

export interface ScreenBudget {
  screen: ScreenId;
  spritesUsed: number;
  spritesLimit: number;
}

export interface SceneBudgetReport {
  perScreen: ScreenBudget[];
  totalNodes: number;
  audioPlayersUsed: number;
  audioChannelsLimit: number;
  trianglesUsed: number;
  trianglesLimit: number;
}

/**
 * Computes how much of the DS's fixed hardware budget a scene tree consumes.
 * Mirrors what Godot's debugger/profiler would show, but against a static
 * hardware ceiling instead of a live frame profile.
 */
export function computeSceneBudget(root: SceneNode): SceneBudgetReport {
  const nodes = flattenSceneTree(root);

  const perScreen: ScreenBudget[] = (["top", "bottom"] as ScreenId[]).map((screen) => ({
    screen,
    spritesUsed: nodes.filter((node) => node.screen === screen && OAM_CONSUMING_KINDS.has(node.kind)).length,
    spritesLimit: DS_HARDWARE_PROFILE.graphics2D.oamSpritesPerScreen
  }));

  // Recomputed from the primitive's geometry, not read from the node's stored count (which may predate a re-tessellation).
  const trianglesUsed = nodes.reduce(
    (sum, node) => sum + (node.mesh ? getPrimitiveTriangleCount(node.mesh.primitive) : 0),
    0
  );

  return {
    perScreen,
    totalNodes: nodes.length,
    audioPlayersUsed: nodes.filter((node) => node.kind === "AudioStreamPlayer").length,
    audioChannelsLimit: DS_HARDWARE_PROFILE.audio.channels,
    trianglesUsed,
    trianglesLimit: DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame
  };
}
