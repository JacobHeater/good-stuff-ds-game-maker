/*
 * TileMap nodes (STORY.standalone-2d-tilemaps.md): a scrollable grid of 8 x 8 tiles, drawn with one DS background layer per
 * screen (BG1) instead of the sprite engine. Identical in spirit to gs_labels.h (a self-contained background-layer setup),
 * but 4bpp (15 colors + transparent, one of the hardware's 16 shared sub-palettes) rather than the console's font, and a
 * script-movable grid rather than fixed text cells.
 *
 * VRAM layout (both engines, same offsets, chosen so a screen's label console -- BG0, charBase 0, mapBase 8 -- and its
 * TileMap -- BG1, charBase 2, mapBase 24 -- never overlap, whichever of them exist): tile graphics take up to 16 KB (512
 * 4bpp tiles, one of them the reserved blank -- the compiler refuses a sheet with more than 511 real tiles, see
 * core's TILE_MAP_MAX_TILES), the map itself one 2 KB block (32 x 32 tiles, the hardware's own smallest background size).
 * The main engine's label and TileMap always share bank A (128 KB,
 * plenty for both); the sub engine's 32 KB bank H is only big enough for its label *or* a TileMap, never both at once, so a
 * TileMap on the bottom screen takes over bank C instead (128 KB, otherwise unused) and the bottom label (if any) moves
 * into it too, at its own usual offsets -- see main.c's bank selection.
 */
#ifndef GS_TILEMAP_H
#define GS_TILEMAP_H

#include <nds.h>

#define GS_TILEMAP_CHAR_BASE 2
#define GS_TILEMAP_MAP_BASE 24
#define GS_TILEMAP_PALETTE_BANK 15

typedef struct {
	const GsTileMap *map;
	int bgId;
	int cameraNode; /* this screen's camera, or -1 (same meaning as ScreenState.cameraNode in main.c) */
} GsTileMapState;

/* Uploads a map's tiles, palette and cell grid to its background layer and gives it a priority behind every sprite (the DS's
   OAM sprites default to priority 0, the front-most; STORY.standalone-2d-camera.md's follow_sprite doesn't change this, so a
   flat 3 here always keeps a TileMap behind the things that stand on it). mainEngine selects bgInit vs bgInitSub, matching
   gs_labels_start's own mainEngine flag. */
static inline void gs_tilemap_start(GsTileMapState *state, const GsTileMap *map, int cameraNode, int mainEngine) {
	state->map = map;
	state->cameraNode = cameraNode;
	state->bgId = mainEngine
		? bgInit(1, BgType_Text4bpp, BgSize_T_256x256, GS_TILEMAP_MAP_BASE, GS_TILEMAP_CHAR_BASE)
		: bgInitSub(1, BgType_Text4bpp, BgSize_T_256x256, GS_TILEMAP_MAP_BASE, GS_TILEMAP_CHAR_BASE);
	bgSetPriority(state->bgId, 3);
	if (mainEngine) REG_DISPCNT |= DISPLAY_BG1_ACTIVE;
	else REG_DISPCNT_SUB |= DISPLAY_BG1_ACTIVE;

	u16 *palette = mainEngine ? &BG_PALETTE[GS_TILEMAP_PALETTE_BANK * 16] : &BG_PALETTE_SUB[GS_TILEMAP_PALETTE_BANK * 16];
	for (int i = 0; i < 16; i++) palette[i] = map->palette[i];

	u16 *tiles = (u16 *)(mainEngine ? BG_TILE_RAM(GS_TILEMAP_CHAR_BASE) : BG_TILE_RAM_SUB(GS_TILEMAP_CHAR_BASE));
	dmaCopy(map->tiles, tiles, map->tileCount * 32);

	u16 *cells = mainEngine ? BG_MAP_RAM(GS_TILEMAP_MAP_BASE) : BG_MAP_RAM_SUB(GS_TILEMAP_MAP_BASE);
	for (int row = 0; row < 32; row++) {
		for (int column = 0; column < 32; column++) {
			const int inRange = column < map->columns && row < map->rows;
			const uint16_t tile = inRange ? map->cells[row * map->columns + column] : 0;
			cells[row * 32 + column] = (GS_TILEMAP_PALETTE_BANK << 12) | (tile & 0x3FF);
		}
	}
}

/* One game frame: scrolls the layer to its node's live position (relative to the screen's camera, if it has one -- exactly
   the offset follow_sprite gives a sprite), or leaves it alone if nothing reaches this map's node (it never moves). */
static inline void gs_tilemap_update(GsTileMapState *state) {
	if (state->map->node < 0) return;
	int32_t x = gs_node_state[state->map->node].position[0];
	int32_t y = gs_node_state[state->map->node].position[1];
	if (state->cameraNode >= 0) {
		x -= gs_node_state[state->cameraNode].position[0];
		y -= gs_node_state[state->cameraNode].position[1];
	}
	bgSetScroll(state->bgId, (x + 2048) >> 12, (y + 2048) >> 12);
}

/* Whether the tile under a world-space pixel position is solid ground (a script's tile_solid(x, y)). The map's own node
   position is where its cell (0, 0) starts -- a script that moves the map (a scrolling parallax layer, say) moves the
   grid this checks against for free. Off the grid, or a map with no sheet, is never solid: a script that wants a level's
   edges to act as walls adds its own bounds check. */
static inline int gs_tilemap_solid(const GsTileMap *map, int32_t x, int32_t y) {
	if (map->node < 0) return 0;
	const int32_t localX = x - gs_node_state[map->node].position[0];
	const int32_t localY = y - gs_node_state[map->node].position[1];
	const int column = (int)(localX >> 15); /* f32 pixels (<<12) / 8 pixels a tile (<<3) */
	const int row = (int)(localY >> 15);
	if (column < 0 || row < 0 || column >= map->columns || row >= map->rows) return 0;
	const int tile = map->cells[row * map->columns + column] - 1; /* physical tile -> sheet frame (0 is the reserved blank) */
	return tile >= 0 && tile < map->solidCount && map->solid[tile];
}

#endif
