/*
 * The layout of the 2D scene the 2D runtime draws. The compiler (@goodstuff/compiler, scene-data-writer.ts `writeScene2DDataC`)
 * generates source/scene2d_data.c filling in these structures; the runtime (source/main.c) only reads them. Keep this file and
 * the writer in step.
 *
 * Every number is already in the DS's own format, converted at compile time:
 *   palette   256 x RGB15 (red in the low five bits); entry 0 is the transparent color
 *   tiles     width * height bytes, one palette index each, in the order the sprite engine reads them: 8 x 8 tiles left to
 *             right, top to bottom, each tile's 64 pixels row by row
 *   x, y      the sprite's top-left corner in screen pixels (may be partly off the screen)
 */
#ifndef GS_SCENE2D_H
#define GS_SCENE2D_H

#include <stdint.h>

/* One sprite image, uploaded to the engine's sprite memory once and shared by every sprite that draws it. */
typedef struct {
	uint16_t width;  /* one frame: one of the DS's sprite sizes: 8, 16, 32 or 64 wide, 8, 16, 32 or 64 high, in the combinations the hardware has */
	uint16_t height;
	uint16_t frameCount; /* 1 for a picture, more for a sprite sheet: the frames share the palette */
	const uint16_t *palette; /* 256 entries, 4-byte aligned */
	const uint8_t *tiles;    /* frameCount frames of width * height bytes, 4-byte aligned */
} GsSpriteImage;

/* One animation of an AnimatedSprite2D: frames of its sheet in order. `step` is animation frames per game frame in 20.12 (4096 = one every game frame). */
typedef struct {
	const uint16_t *frames;
	uint16_t length;
	uint8_t loop;
	uint32_t step;
} GsSpriteAnimation;

/* One Sprite2D. The screen's sprite list is in hardware order: the first entry is drawn over all the others. Identical layout to the 3D runtime's own GsSprite
   (scene.h): a script can reach a sprite in either kind of project the same way. */
typedef struct {
	int16_t x; /* top-left corner in screen pixels as the sprite starts (with a rotation matrix: of the doubled box the picture is drawn in) */
	int16_t y;
	uint16_t image; /* index into the images */
	int16_t node;   /* index into GsScene2D.nodes: its position (x, y pixels), rotation (third slot, degrees clockwise), scale (x, y) and visibility are the sprite's; -1: none */
	uint8_t dynamic; /* 1: a script can change it, so it follows its node every frame */
	int8_t affine;  /* the rotation matrix (0..31) it is drawn with, or -1 */
	int32_t rotation; /* as it starts: degrees clockwise, f32 */
	int32_t scaleX;   /* and the scale on each axis, f32 (negative flips) */
	int32_t scaleY;
	int16_t animation;       /* the animation that plays when the scene starts (an index into the screen's animations), or -1 for none (it shows frame 0) */
	uint16_t animationFirst; /* the sprite's own animations start here in the table, in the order a script's play("name") counts them */
	uint16_t animationCount;
} GsSprite;

/* One Label: text on the screen's 8 x 8 grid (column 0..31, row 0..23), in a console color (0 black, 1 red ... 7 white), with `{}` in the text standing for the label's value. */
typedef struct {
	uint8_t column;
	uint8_t row;
	uint8_t color;
	uint8_t visible; /* whether it shows when the scene starts */
	int16_t node;    /* index into GsScene2D.nodes: its visibility is the node's; -1: none (no script can reach it) */
	const char *text;
} GsLabel;

/* One node a script can reach: its starting position, rotation, scale and visibility, exactly as GsNodeState (gs_api.h) holds them live. No parent or world
   transform -- a 2D project's positions are always absolute screen pixels, never composed from an ancestor. */
typedef struct {
	int32_t position[3]; /* f32; only [0] (x) and [1] (y) are meaningful */
	int32_t rotation[3]; /* f32 degrees; only [2] is meaningful (a sprite's clockwise rotation) */
	int32_t scale[3];    /* f32; only [0] (x) and [1] (y) are meaningful */
	uint8_t visible;
} GsNode2D;

/* One sound, shared by every audio player that uses it. Identical layout to the 3D runtime's own GsSound (scene.h). */
typedef struct {
	uint32_t byteCount;
	uint16_t sampleRate; /* as recorded, in Hz */
	uint8_t format;      /* a libnds SoundFormat: SoundFormat_16Bit (1) or SoundFormat_ADPCM (2) */
	const void *data;
} GsSound;

/* One named clip of an AudioStreamPlayer (GsAudioPlayer.clipStart/clipCount below), playable with play("name"). Identical layout to the 3D runtime's own GsAudioClip. */
typedef struct {
	uint16_t sound;     /* index into GsScene2D.sounds */
	uint16_t frequency; /* playback rate in Hz */
	uint8_t volume;     /* 0..127 */
	uint8_t loop;
} GsAudioClip;

/* One AudioStreamPlayer: which sound and how to play it. Same shape as the 3D runtime's own GsAudioPlayer, plus `node` (a 2D
   project has two screens' worth of players to search, where a 3D project's one 2D screen never needed this). */
typedef struct {
	int16_t sound;      /* index into GsScene2D.sounds, or -1 for a player with no sound of its own (named clips only) */
	uint16_t frequency; /* playback rate in Hz */
	uint8_t volume;     /* 0..127 */
	uint8_t loop;
	uint8_t autoplay;   /* never true when sound is -1 */
	uint16_t clipStart; /* index into GsScene2D.audioClips: this player's own named clips are clipStart .. clipStart + clipCount */
	uint8_t clipCount;
	int16_t node;       /* index into GsScene2D.nodes, or -1 when no script can reach this player */
} GsAudioPlayer;

/* One CollisionShape2D a script can reach: a rect or a circle, centered on its node's position (GsScene2D.nodes[node]).
   `p` is half the rect's width and height (f32, as a 3D box's half extents already are), or the circle's radius in `p[0]`
   (`p[1]` unused). Only a shape a script actually reaches has one of these -- see translate-scene-2d.ts's collectCollision2D. */
typedef struct {
	uint8_t shape; /* 0 = rect, 1 = circle */
	int32_t p[2];
	int16_t node;
} GsCollider2D;

/* One TileMap (STORY.standalone-2d-tilemaps.md): a scrollable grid of 8 x 8 tiles drawn with the background hardware instead
   of the sprite engine. `tiles` is `tileCount` physical tiles of 32 nibble-packed bytes each (two 4-bit palette indices a
   byte); tile 0 is always a reserved, fully transparent blank, so a sheet's own frame N is physical tile N + 1. `cells` is
   `columns * rows` physical tile indices, row by row. `solid` has one entry a *sheet frame* index (not a physical tile
   index): whether a script's tile_solid() reports that tile as solid ground. `node` is this map's own place in
   GsScene2D.nodes (its position, for a script to move it and for the runtime to scroll it with its screen's camera), or -1
   when nothing reaches it (it never moves from where it starts). */
typedef struct {
	uint8_t screen; /* 0 = top (main engine), 1 = bottom (sub engine) */
	uint8_t columns;
	uint8_t rows;
	uint16_t palette[16]; /* RGB15; entry 0 is the transparent color */
	uint16_t tileCount;
	const uint8_t *tiles;
	const uint16_t *cells;
	uint16_t solidCount;
	const uint8_t *solid;
	int16_t node;
} GsTileMap;

/* What one 2D engine draws. Each image takes one of the engine's 16 extended palettes, in order. */
typedef struct {
	uint16_t imageCount;
	uint16_t spriteCount;
	const GsSpriteImage *images;
	const GsSprite *sprites;
	uint16_t animationCount;
	const GsSpriteAnimation *animations;
	uint16_t labelCount;
	const GsLabel *labels;
} GsScreen2D;

typedef struct {
	uint8_t fps; /* 30 or 60 */
	GsScreen2D top;    /* the main engine */
	GsScreen2D bottom; /* the sub engine */
	uint16_t nodeCount; /* every node a script attaches to or names with $Name, across both screens; 0 when no script runs */
	const GsNode2D *nodes;
	uint16_t soundCount;
	const GsSound *sounds;
	uint16_t audioPlayerCount;
	const GsAudioPlayer *audioPlayers;
	uint16_t audioClipCount;
	const GsAudioClip *audioClips;
	uint16_t colliderCount;
	const GsCollider2D *colliders;
	uint16_t tileMapCount;
	const GsTileMap *tileMaps;
	/* Each screen's active Camera2D: its place in `nodes`, or -1 for no camera (every sprite stays at its own absolute
	   position, exactly as before this existed). See STORY.standalone-2d-camera.md. */
	int16_t topCamera;
	int16_t bottomCamera;
} GsScene2D;

extern const GsScene2D gs_scene2d;

#endif
