/*
 * Spawn pools (STORY.spawn-pools.md): a pre-built, initially hidden run of `count` identical copies of a template
 * scene, each independently spawn()/despawn()-able by a script at runtime -- the real, hardware-possible shape of
 * "create something at runtime" on an engine with no dynamic scene graph. The copies' own nodes are one
 * contiguous run of GsScene.nodes (GsSpawnPool's own comment in scene.h explains why slot i's own root is always
 * nodeStart + i * nodesPerCopy); spawning one only ever needs to touch that one root node, because every node of
 * a pool's own copy is compiled `dynamic` (translate-scene-3d.ts's own spawn-pool handling), so the usual
 * per-frame world-transform cascade (gs_update_nodes, compose_node) already carries the move down to the whole
 * subtree -- there is no spawn-pool-specific drawing path here at all.
 */
#include <stdlib.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "scene.h"

typedef struct {
	uint8_t *used; /* one byte per slot, 0 = free */
} SpawnPoolState;
static SpawnPoolState *spawnPoolState;

void gs_spawn_pools_reset(void) {
	if (spawnPoolState) {
		for (int i = 0; i < gs_scene.spawnPoolCount; i++) free(spawnPoolState[i].used);
	}
	free(spawnPoolState);
	spawnPoolState = 0;
}

void gs_init_spawn_pools(void) {
	gs_spawn_pools_reset();
	if (gs_scene.spawnPoolCount == 0) return;
	spawnPoolState = malloc(sizeof(SpawnPoolState) * gs_scene.spawnPoolCount);
	for (int i = 0; i < gs_scene.spawnPoolCount; i++) spawnPoolState[i].used = calloc(gs_scene.spawnPools[i].count, 1);
}

/* A handle names one pool's own one slot (the pool index packed with the slot index): an opaque int a script
   holds, never a node reference it could otherwise reach the spawned copy by (STORY.spawn-pools.md's own v1
   limit -- a spawned copy has no $Name, nothing to move it afterward except despawn()). */
static int handle_of(int pool, int slot) { return (pool << 16) | slot; }
static int pool_of(int handle) { return handle < 0 ? -1 : handle >> 16; }
static int slot_of(int handle) { return handle < 0 ? -1 : handle & 0xffff; }

int gs_spawn(int pool, int32_t x, int32_t y, int32_t z) {
	if (pool < 0 || pool >= gs_scene.spawnPoolCount) return -1;
	const GsSpawnPool *p = &gs_scene.spawnPools[pool];
	for (int s = 0; s < p->count; s++) {
		if (spawnPoolState[pool].used[s]) continue;
		spawnPoolState[pool].used[s] = 1;
		const int rootIndex = p->nodeStart + s * p->nodesPerCopy;
		gs_node_state[rootIndex].position[0] = x;
		gs_node_state[rootIndex].position[1] = y;
		gs_node_state[rootIndex].position[2] = z;
		gs_node_state[rootIndex].visible = 1;
		return handle_of(pool, s);
	}
	return -1; /* the pool's own N copies are all already spawned */
}

void gs_despawn(int handle) {
	const int pool = pool_of(handle), slot = slot_of(handle);
	if (pool < 0 || pool >= gs_scene.spawnPoolCount || slot < 0 || slot >= gs_scene.spawnPools[pool].count) return;
	spawnPoolState[pool].used[slot] = 0;
	gs_node_state[gs_scene.spawnPools[pool].nodeStart + slot * gs_scene.spawnPools[pool].nodesPerCopy].visible = 0;
}

int gs_is_spawned(int handle) {
	const int pool = pool_of(handle), slot = slot_of(handle);
	if (pool < 0 || pool >= gs_scene.spawnPoolCount || slot < 0 || slot >= gs_scene.spawnPools[pool].count) return 0;
	return spawnPoolState[pool].used[slot];
}
