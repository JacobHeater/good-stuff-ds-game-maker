/*
 * TileMap3D: chunks streamed from the ROM's own NitroFS region, not resident all at once (STORY.tile-map-3d.md's
 * Phase 3). Split out of main.c (which keeps only the GL-specific `tm3d_draw_node`/`draw_tile_maps_3d`) so a
 * script's own `gs_tile_solid_3d` query -- and the hardware-test harness, which replaces main.c wholesale -- can
 * reach this state too.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "gs_tile_map_3d.h"
#include "scene.h"

Tm3dSlot *tm3d_slots;
static int *tm3d_center; /* 3 ints (cx, cy, cz) per TileMap3D node, flat */
static uint8_t *tm3d_has_center;
/* Reused scratch space for whichever TileMap3D tm3d_refresh is currently recentring (one at a time, never concurrently)
   -- TM3D_SLOTS Tm3dSlot structures is tens of KB, too large to put on the ARM9's own small stack. */
static Tm3dSlot *tm3d_scratch;

void tm3d_free_tables(void) {
	free(tm3d_slots);
	free(tm3d_center);
	free(tm3d_has_center);
	free(tm3d_scratch);
	tm3d_slots = 0;
	tm3d_center = 0;
	tm3d_has_center = 0;
	tm3d_scratch = 0;
}

void tm3d_init(void) {
	tm3d_free_tables();
	if (gs_scene.tileMap3DCount == 0) return;
	tm3d_slots = malloc(sizeof(Tm3dSlot) * TM3D_SLOTS * gs_scene.tileMap3DCount);
	tm3d_center = malloc(sizeof(int) * 3 * gs_scene.tileMap3DCount);
	tm3d_has_center = calloc(gs_scene.tileMap3DCount, 1);
	tm3d_scratch = malloc(sizeof(Tm3dSlot) * TM3D_SLOTS);
	for (int i = 0; i < TM3D_SLOTS * gs_scene.tileMap3DCount; i++) tm3d_slots[i].valid = 0;
}

/* `worldPos` (f32, world space) expressed in TileMap3D node `node`'s own local space: the inverse of compose_node's
   own rotation + scale + translation (gs_runtime.c) -- the same way gs_compute_view inverts a camera's rotation and
   translation, with scale (ignored for a camera, but not for a grid: scaling a TileMap3D scales its cell spacing
   too) divided back out afterward. Used only to decide which chunk is nearest the camera, an occasional calculation,
   not a per-vertex one. */
static void tm3d_world_to_local(int node, const int32_t worldPos[3], int32_t out[3]) {
	const int32_t *w = gs_world_matrix[node].m;
	int32_t rel[3];
	for (int row = 0; row < 3; row++) rel[row] = worldPos[row] - w[12 + row];
	for (int row = 0; row < 3; row++) {
		int64_t sum = 0;
		for (int k = 0; k < 3; k++) sum += (int64_t)w[row * 4 + k] * rel[k]; /* row of R^T == row of R read across, not down -- see gs_compute_view's own comment */
		out[row] = gs_divf((int32_t)(sum >> 12), gs_world_scale[node][row]);
	}
}

/* Loads chunk (cx, cy, cz) of `tileMap` into `slot`, or leaves it all zero (an empty chunk) when that chunk has no
   file at all -- translate-tile-map-3d.ts never writes one for a chunk with no painted cells, so a missing file is
   the ordinary, expected case for most of a sparse world, not an error. */
static void tm3d_load(const GsTileMap3D *tileMap, int cx, int cy, int cz, Tm3dSlot *slot) {
	slot->valid = 1;
	slot->cx = cx;
	slot->cy = cy;
	slot->cz = cz;
	memset(slot->cells, 0, sizeof(slot->cells));
	char path[96];
	snprintf(path, sizeof(path), "nitro:/%s%d_%d_%d.bin", tileMap->chunkPathPrefix, cx, cy, cz);
	FILE *f = fopen(path, "rb");
	if (!f) return;
	fread(slot->cells, 1, TM3D_CHUNK_BYTES, f);
	fclose(f);
}

/* Recentres TileMap3D `t`'s own window of loaded chunks on wherever the camera now is, if it has crossed into a
   different chunk since the last time this ran (the common case, most frames: nothing to do, one integer compare
   per axis). A slot already holding the right chunk is kept as-is rather than reloaded -- sliding the window by one
   chunk, the ordinary case of the camera walking through the world, reuses most of it. */
void tm3d_refresh(int t, const GsTileMap3D *tileMap, const int32_t cameraWorld[3]) {
	int32_t local[3];
	tm3d_world_to_local(tileMap->node, cameraWorld, local);
	/* Floor to the containing cell (f32 -> int, arithmetic shift so a negative position floors correctly, same
	   convention this runtime already relies on elsewhere -- see mat4_multiply's own `>> 12`), then floor-divide by
	   TM3D_CHUNK_SIZE (a power of two: another arithmetic shift) to the chunk it's in -- chunkOf's own math in
	   packages/core/src/tile-map-3d.ts, just done in fixed point instead of on a stored integer cell coordinate. */
	int cx = (local[0] >> 12) >> 3, cy = (local[1] >> 12) >> 3, cz = (local[2] >> 12) >> 3;

	int *center = &tm3d_center[t * 3];
	if (tm3d_has_center[t] && center[0] == cx && center[1] == cy && center[2] == cz) return;

	Tm3dSlot *slots = &tm3d_slots[t * TM3D_SLOTS];
	const int half = TM3D_WINDOW / 2;
	int n = 0;
	for (int dz = -half; dz <= half; dz++) {
		for (int dy = -half; dy <= half; dy++) {
			for (int dx = -half; dx <= half; dx++) {
				int wx = cx + dx, wy = cy + dy, wz = cz + dz;
				int found = -1;
				for (int i = 0; i < TM3D_SLOTS; i++) {
					if (slots[i].valid && slots[i].cx == wx && slots[i].cy == wy && slots[i].cz == wz) {
						found = i;
						break;
					}
				}
				if (found >= 0) tm3d_scratch[n] = slots[found];
				else tm3d_load(tileMap, wx, wy, wz, &tm3d_scratch[n]);
				n++;
			}
		}
	}
	memcpy(slots, tm3d_scratch, sizeof(Tm3dSlot) * TM3D_SLOTS);
	center[0] = cx;
	center[1] = cy;
	center[2] = cz;
	tm3d_has_center[t] = 1;
}

/*
 * A script's own `tile_solid_3d(x, y, z)` (STORY.tile-map-3d.md): is the painted tile at this world position solid
 * ground? Two real limitations this has that a plain TileMap/CollisionShape3D query never does, both inherent to
 * TileMap3D's own chunk-streaming design (see this file's own top comment):
 *   1. A chunk outside the runtime's own streamed TM3D_WINDOW around the camera reads as not-solid, not "unknown" --
 *      a body far from the camera (an off-screen enemy, a projectile) cannot reliably query solidity there.
 *   2. The window is only recentred once a frame, in the render pass (main.c's own draw_tile_maps_3d, called after
 *      scripts run) -- so a script's own query in a given frame reflects the PREVIOUS frame's camera position, not
 *      the one it's about to move to this frame.
 */
int gs_tile_solid_3d(int node, int32_t x, int32_t y, int32_t z) {
	for (int t = 0; t < gs_scene.tileMap3DCount; t++) {
		const GsTileMap3D *tileMap = &gs_scene.tileMaps3D[t];
		if (tileMap->node != node) continue;
		const int32_t world[3] = { x, y, z };
		int32_t local[3];
		tm3d_world_to_local(tileMap->node, world, local);
		const int cellX = local[0] >> 12, cellY = local[1] >> 12, cellZ = local[2] >> 12;
		const int cx = cellX >> 3, cy = cellY >> 3, cz = cellZ >> 3;
		const Tm3dSlot *slots = &tm3d_slots[t * TM3D_SLOTS];
		for (int s = 0; s < TM3D_SLOTS; s++) {
			if (!slots[s].valid || slots[s].cx != cx || slots[s].cy != cy || slots[s].cz != cz) continue;
			const int lx = cellX - cx * TM3D_CHUNK_SIZE, ly = cellY - cy * TM3D_CHUNK_SIZE, lz = cellZ - cz * TM3D_CHUNK_SIZE;
			const int cellIndex = lx + ly * TM3D_CHUNK_SIZE + lz * TM3D_CHUNK_SIZE * TM3D_CHUNK_SIZE;
			const uint8_t raw = slots[s].cells[cellIndex * 2];
			if (raw == 0) return 0; /* unpainted */
			const int paletteLocal = raw - 1;
			if (paletteLocal >= tileMap->paletteCount) return 0; /* stale data naming a palette entry this scene no longer has */
			return gs_scene.tileMap3DPaletteEntries[tileMap->paletteStart + paletteLocal].solid;
		}
		return 0; /* this chunk isn't currently loaded */
	}
	return 0; /* no TileMap3D at this node */
}
