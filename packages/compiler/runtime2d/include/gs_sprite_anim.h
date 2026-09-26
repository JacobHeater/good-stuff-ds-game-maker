/*
 * The frame-by-frame part of an AnimatedSprite2D, with nothing of the DS in it: which frame of its sheet a sprite is showing, and how a game frame moves it on. Both runtimes use it
 * (runtime/ for a 3D project's 2D screen and runtime2d/ for a 2D project), and the two copies of this file are identical (a unit test checks it). Include it after the header that
 * declares GsSpriteAnimation (scene.h or scene2d.h).
 *
 * Requirements: requirements/scene-designer/STORY.animated-sprites.md
 */
#ifndef GS_SPRITE_ANIM_H
#define GS_SPRITE_ANIM_H

#include <stdint.h>

typedef struct {
	int16_t animation;  /* the animation playing (an index into the screen's animations), or -1 for none */
	uint16_t position;  /* which of the animation's frames it is on */
	uint32_t timer;     /* how far through the current frame, 20.12: 4096 is a whole frame */
	uint16_t frame;     /* the frame of the sheet being shown */
	uint16_t shown;     /* the frame the hardware sprite was last told to show (the runtime tells it again when this differs from `frame`) */
	uint8_t playing;
} GsSpriteAnimState;

/* Starts an animation from its first frame. */
static inline void gs_anim_start(GsSpriteAnimState *state, const GsSpriteAnimation *animations, int animation) {
	state->animation = (int16_t)animation;
	state->position = 0;
	state->timer = 0;
	state->playing = 1;
	state->frame = animations[animation].frames[0];
}

/* Moves one game frame on: adds the animation's step, and goes to the next frame each time that adds up to a whole one. At the end it starts over (a looping animation) or stops on the last frame. */
static inline void gs_anim_step(GsSpriteAnimState *state, const GsSpriteAnimation *animations) {
	if (!state->playing || state->animation < 0) return;
	const GsSpriteAnimation *animation = &animations[state->animation];
	state->timer += animation->step;
	while (state->timer >= 4096) {
		state->timer -= 4096;
		if ((uint32_t)state->position + 1 < animation->length) {
			state->position++;
		} else if (animation->loop) {
			state->position = 0;
		} else {
			state->playing = 0;
			state->timer = 0;
			break;
		}
	}
	state->frame = animation->frames[state->position];
}

#endif
