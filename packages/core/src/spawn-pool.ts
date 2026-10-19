/**
 * A spawn pool (requirements/scene-designer/STORY.spawn-pools.md): a scene instance whose own `spawnPoolCount` is
 * more than 1 (`scene-node.ts`'s own comment on that field explains the whole feature). This file is just the
 * small shared constants/helpers `project-scenes.ts`'s `expandSpawnPools`, the compiler and the editor all need,
 * the same role `inventory.ts`'s own constants/clamp helpers play for `InventoryData`.
 */

export const SPAWN_POOL_COUNT_MIN = 1;
/** Conservative next to Inventory's own 64 slots: a pool slot duplicates a whole subtree's worth of sprites/triangles, not one scalar. */
export const SPAWN_POOL_COUNT_MAX = 16;

/** `spawnPoolCount`, clamped to `SPAWN_POOL_COUNT_MIN..MAX`; `undefined` (not a pool at all) stays `undefined`. */
export function clampSpawnPoolCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(SPAWN_POOL_COUNT_MAX, Math.max(SPAWN_POOL_COUNT_MIN, Math.round(value)));
}

/** Whether a node is a spawn pool (an instance with more than one copy), not an ordinary single instance. */
export function isSpawnPool(node: { instanceOf?: string; spawnPoolCount?: number }): boolean {
  return node.instanceOf !== undefined && (clampSpawnPoolCount(node.spawnPoolCount) ?? 1) > 1;
}
