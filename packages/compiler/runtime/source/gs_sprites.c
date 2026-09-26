/*
 * Sprites on the 2D screen of a 3D project: the sub engine draws them on the screen the 3D engine is not on. The images are copied into sprite memory once, each with its
 * palette in the extended-palette slot of the same number, and the sprites are set up as they are (the scene does not move them yet).
 *
 * Requirements: requirements/scene-designer/STORY.sprites-on-the-2d-screen-of-a-3d-project.md
 */
#include <nds.h>
#include <stdlib.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "scene.h"
#include "gs_sprite_anim.h"

/* Where each frame of each image sits in sprite memory, and how far each sprite's animation has got. */
static u16 **frame_gfx[16];
static GsSpriteAnimState anim_state[128];

static void animate(int index, const GsSprite *sprite, const GsScreen2D *screen);

static SpriteSize size_of(int width, int height) {
	switch (width * 100 + height) {
	case 808: return SpriteSize_8x8;
	case 1616: return SpriteSize_16x16;
	case 3232: return SpriteSize_32x32;
	case 6464: return SpriteSize_64x64;
	case 1608: return SpriteSize_16x8;
	case 3208: return SpriteSize_32x8;
	case 3216: return SpriteSize_32x16;
	case 6432: return SpriteSize_64x32;
	case 816: return SpriteSize_8x16;
	case 832: return SpriteSize_8x32;
	case 1632: return SpriteSize_16x32;
	default: return SpriteSize_32x64;
	}
}

/* A pixel position from a position in f32 (20.12), rounded to the nearest whole pixel. */
static int round_px(int32_t f) { return (f + 2048) >> 12; }

/*
 * The rotation matrix of an affine sprite. The angle is in degrees (f32), clockwise on the screen; the hardware's angle is 0..32767 for a whole turn. The scale is a factor
 * on each axis (f32); the matrix wants its inverse in 8.8 fixed point (a picture drawn twice as big samples every other texel), so a scale of 1 is 256. A scale of nothing
 * (or a huge one, from a script) is held to what the editor allows: 1/16 to 8 times, its sign (a flip) kept.
 */
static void set_matrix(int matrix, int32_t degrees, int32_t scale_x, int32_t scale_y) {
	const int angle = (int)(((int64_t)degrees * 32768) / (360 * 4096)) & 0x7FFF;
	int32_t sx = scale_x, sy = scale_y;
	if (sx > -256 && sx < 256) sx = sx < 0 ? -256 : 256;
	if (sy > -256 && sy < 256) sy = sy < 0 ? -256 : 256;
	if (sx > 32768) sx = 32768;
	if (sx < -32768) sx = -32768;
	if (sy > 32768) sy = 32768;
	if (sy < -32768) sy = -32768;
	oamRotateScale(&oamSub, matrix, angle, (int)(1048576 / sx), (int)(1048576 / sy));
}

/* Brings a sprite up to date with its node: where it is, whether it is shown, and (with a rotation matrix) its angle and scale. */
static void follow(int index, const GsSprite *sprite, const GsSpriteImage *image) {
	const GsNodeState *state = &gs_node_state[sprite->node];
	int x = round_px(state->position[0]);
	int y = round_px(state->position[1]);
	if (sprite->affine >= 0) {
		set_matrix(sprite->affine, state->rotation[2], state->scale[0], state->scale[1]);
		/* The hardware draws a rotating sprite in a box twice its size, centred on the picture. */
		x -= image->width;
		y -= image->height;
	} else {
		x -= image->width / 2;
		y -= image->height / 2;
	}
	oamSetXY(&oamSub, index, x, y);
	oamSetHidden(&oamSub, index, !state->visible);
}

/* Gives back the sprite memory of the scene being shown and hides its sprites (the next scene sets up its own). */
void gs_sprites_reset(void) {
	const GsScreen2D *screen = &gs_scene.sprites2D;
	for (int i = 0; i < 16; i++) {
		if (!frame_gfx[i]) continue;
		if (i < screen->imageCount) {
			for (int f = 0; f < screen->images[i].frameCount; f++) {
				if (frame_gfx[i][f]) oamFreeGfx(&oamSub, frame_gfx[i][f]);
			}
		}
		free(frame_gfx[i]);
		frame_gfx[i] = 0;
	}
	if (screen->spriteCount > 0) {
		oamClear(&oamSub, 0, 128);
		oamUpdate(&oamSub);
	}
}

void gs_init_sprites(void) {
	const GsScreen2D *screen = &gs_scene.sprites2D;
	if (screen->spriteCount == 0) return;

	/* Bank D (tile memory, mapped by main.c) and bank I: mapped as plain memory while the palettes are written, then as the sub engine's sprite palettes. */
	vramSetBankI(VRAM_I_LCD);
	videoSetModeSub(MODE_0_2D | DISPLAY_SPR_ACTIVE | DISPLAY_SPR_1D_LAYOUT);
	oamInit(&oamSub, SpriteMapping_1D_32, true);

	for (int i = 0; i < 16; i++) frame_gfx[i] = 0;
	for (int i = 0; i < screen->imageCount && i < 16; i++) {
		const GsSpriteImage *image = &screen->images[i];
		const int bytes = image->width * image->height;
		frame_gfx[i] = malloc(sizeof(u16 *) * image->frameCount);
		for (int f = 0; f < image->frameCount; f++) {
			u16 *gfx = oamAllocateGfx(&oamSub, size_of(image->width, image->height), SpriteColorFormat_256Color);
			frame_gfx[i][f] = gfx;
			if (gfx) dmaCopy(image->tiles + f * bytes, gfx, bytes);
		}
		for (int c = 0; c < 256; c++) VRAM_I_EXT_SPR_PALETTE[i][c] = image->palette[c];
	}
	for (int i = 0; i < screen->spriteCount && i < 128; i++) {
		const GsSprite *sprite = &screen->sprites[i];
		const GsSpriteImage *image = &screen->images[sprite->image];
		GsSpriteAnimState *anim = &anim_state[i];
		anim->animation = -1;
		anim->playing = 0;
		anim->frame = 0;
		if (sprite->animation >= 0) gs_anim_start(anim, screen->animations, sprite->animation);
		anim->shown = anim->frame;
		if (!frame_gfx[sprite->image] || !frame_gfx[sprite->image][anim->frame]) continue;
		const int rotating = sprite->affine >= 0;
		oamSet(&oamSub, i, sprite->x, sprite->y, 0, sprite->image, size_of(image->width, image->height), SpriteColorFormat_256Color,
			frame_gfx[sprite->image][anim->frame], rotating ? sprite->affine : -1, rotating, false, false, false, false);
		if (rotating) set_matrix(sprite->affine, sprite->rotation, sprite->scaleX, sprite->scaleY);
		if (sprite->dynamic && sprite->node >= 0) follow(i, sprite, image);
	}
	vramSetBankI(VRAM_I_SUB_SPRITE_EXT_PALETTE);
}

void gs_update_sprites(void) {
	const GsScreen2D *screen = &gs_scene.sprites2D;
	if (screen->spriteCount == 0) return;
	/* The sprites a script can change follow their nodes (scripts have run for this frame); the others were set up once. */
	for (int i = 0; i < screen->spriteCount && i < 128; i++) {
		const GsSprite *sprite = &screen->sprites[i];
		if (sprite->dynamic && sprite->node >= 0) follow(i, sprite, &screen->images[sprite->image]);
		if (sprite->animation >= 0 || sprite->animationCount > 0) animate(i, sprite, screen);
	}
	oamUpdate(&oamSub);
}

/* One game frame of an animated sprite: its animation moves on (a script may have started or stopped it), and the hardware sprite shows the frame it is now on. */
static void animate(int index, const GsSprite *sprite, const GsScreen2D *screen) {
	GsSpriteAnimState *anim = &anim_state[index];
	gs_anim_step(anim, screen->animations);
	if (anim->frame == anim->shown) return;
	const GsSpriteImage *image = &screen->images[sprite->image];
	if (frame_gfx[sprite->image] && frame_gfx[sprite->image][anim->frame]) {
		oamSetGfx(&oamSub, index, size_of(image->width, image->height), SpriteColorFormat_256Color, frame_gfx[sprite->image][anim->frame]);
	}
	anim->shown = anim->frame;
}

/* The sprite that draws a node, or -1. */
static int sprite_of_node(int node) {
	const GsScreen2D *screen = &gs_scene.sprites2D;
	for (int i = 0; i < screen->spriteCount && i < 128; i++) {
		if (screen->sprites[i].node == node) return i;
	}
	return -1;
}

/* `animation` counts among the animations the sprite has, in the order of the node's list (what a script's play("name") resolved to). */
void gs_sprite_play(int node, int animation) {
	const int i = sprite_of_node(node);
	if (i < 0) return;
	const GsSprite *sprite = &gs_scene.sprites2D.sprites[i];
	if (animation < 0 || animation >= sprite->animationCount) return;
	gs_anim_start(&anim_state[i], gs_scene.sprites2D.animations, sprite->animationFirst + animation);
}

void gs_sprite_stop(int node) {
	const int i = sprite_of_node(node);
	if (i >= 0) anim_state[i].playing = 0;
}

int gs_sprite_is_playing(int node) {
	const int i = sprite_of_node(node);
	return i >= 0 && anim_state[i].playing;
}
