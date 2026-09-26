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

/* One Sprite2D. The screen's sprite list is in hardware order: the first entry is drawn over all the others. */
typedef struct {
	int16_t x;
	int16_t y;
	uint16_t image; /* index into the screen's images */
	int16_t animation;       /* the animation that plays when the scene starts (an index into the screen's animations), or -1 for none (it shows frame 0) */
	uint16_t animationFirst; /* the sprite's own animations start here in the table (only scripts of a 3D project pick one by name) */
	uint16_t animationCount;
} GsSprite;

/* One Label: text on the screen's 8 x 8 grid (column 0..31, row 0..23), in a console color (0 black, 1 red ... 7 white), with `{}` in the text standing for the label's value (always 0 here). */
typedef struct {
	uint8_t column;
	uint8_t row;
	uint8_t color;
	uint8_t visible;
	int16_t node; /* only in 3D projects */
	const char *text;
} GsLabel;

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
} GsScene2D;

extern const GsScene2D gs_scene2d;

#endif
