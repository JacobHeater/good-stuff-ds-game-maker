/*
 * TileMap3D's own chunk-streaming state (gs_tile_map_3d.c): what main.c's own drawing code needs to read
 * (tm3d_slots, the chunk macros, the Tm3dSlot layout) and what it calls once a scene starts and once a frame.
 * Split out of main.c so gs_tile_solid_3d (STORY.tile-map-3d.md) -- and the hardware-test harness, which replaces
 * main.c wholesale -- can reach this state too, without pulling in anything GL/drawing-specific.
 */
#ifndef GS_TILE_MAP_3D_H
#define GS_TILE_MAP_3D_H

#include <stdint.h>

#include "scene.h"

/* Must match TILE_MAP_3D_CHUNK_SIZE (packages/core/src/tile-map-3d.ts) and translate-tile-map-3d.ts's own chunk file
   format: CHUNK_SIZE^3 cells, 2 bytes each (palette index + 1, 0 = empty; then rotationY), indexed lx + ly*8 + lz*64. */
#define TM3D_CHUNK_SIZE 8
#define TM3D_CELLS_PER_CHUNK (TM3D_CHUNK_SIZE * TM3D_CHUNK_SIZE * TM3D_CHUNK_SIZE)
#define TM3D_CHUNK_BYTES (TM3D_CELLS_PER_CHUNK * 2)
/* A 3x3x3 window of loaded chunks around the camera (24 scene units to a side, at the default chunk size) --
   proves the point of streaming (a painted world far larger than this is never resident at once) without needing
   many chunks loaded just to avoid visible pop-in as the camera moves. */
#define TM3D_WINDOW 3
#define TM3D_SLOTS (TM3D_WINDOW * TM3D_WINDOW * TM3D_WINDOW)

typedef struct {
	int valid; /* this slot's (cx, cy, cz) is the most recent load attempt for that position, and `cells` reflects it exactly -- either real chunk data, or all zero (an empty chunk, same as one with no file: translate-tile-map-3d.ts never writes an empty chunk's file at all) */
	int cx, cy, cz;
	uint8_t cells[TM3D_CHUNK_BYTES];
} Tm3dSlot;

/* One fixed pool of TM3D_SLOTS slots per TileMap3D node in the scene, flat (tm3d_slots[tileMapIndex * TM3D_SLOTS + slot]) --
   allocated in tm3d_init, read directly by main.c's own tm3d_draw_node for rendering and by gs_tile_solid_3d for a
   script's own query, the same way gs_world_matrix is shared between gs_runtime.c and main.c. */
extern Tm3dSlot *tm3d_slots;

/* Allocates (freeing any previous scene's own tables first) the per-TileMap3D-node slot pools for gs_scene's own
   TileMap3D count. Called once from enter_scene, alongside every other per-scene table. */
void tm3d_init(void);
void tm3d_free_tables(void);
/* Recentres TileMap3D `t`'s own window of loaded chunks on wherever `cameraWorld` now is, if it has crossed into a
   different chunk since the last time this ran. Called once a frame, after scripts run (main.c's own draw_tile_maps_3d). */
void tm3d_refresh(int t, const GsTileMap3D *tileMap, const int32_t cameraWorld[3]);

#endif
