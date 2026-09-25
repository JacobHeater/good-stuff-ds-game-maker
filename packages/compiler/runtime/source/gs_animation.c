/*
 * The AnimationPlayer's runtime: each player has one animation playing (or none), a time and a speed. Requirements: requirements/animation/TASK.compile-and-run-animations.md
 *
 * Each frame, after the scripts and before the nodes' transforms are worked out, every playing animation advances by `delta * speed`; at the end of a looping
 * animation the time wraps, otherwise the animation stops on its last frame; then each of its tracks writes the value at that time into the property it animates:
 * a straight-line blend between the two keys either side of the time, the first key's value before the first and the last key's after the last, and for a bool
 * (visibility) the value of the latest key at or before the time. This is the same rule as `sampleTrack` in packages/core/src/animation.ts.
 */
#include <nds.h>
#include <stdint.h>
#include <stdlib.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "scene.h"

typedef struct {
	int anim;       /* index within the player's animations, or -1 when none is playing */
	int32_t time;   /* seconds into the animation, f32 */
	int32_t speed;  /* f32 */
	uint8_t playing;
} AnimState;
static AnimState *anim_state;

/* Writes the value of `track` at `time` into the node's state. */
static void apply_track(const GsAnimTrack *track, int32_t time) {
	if (track->keyCount == 0) return;
	const GsAnimKey *keys = &gs_scene.animKeys[track->keyStart];
	int last = track->keyCount - 1;
	int32_t value[3];
	if (time <= keys[0].time) {
		for (int c = 0; c < 3; c++) value[c] = keys[0].value[c];
	} else if (time >= keys[last].time) {
		for (int c = 0; c < 3; c++) value[c] = keys[last].value[c];
	} else {
		int i = 0;
		while (keys[i + 1].time <= time) i++;
		const GsAnimKey *a = &keys[i], *b = &keys[i + 1];
		if (track->property == GS_ANIM_VISIBLE) {
			for (int c = 0; c < 3; c++) value[c] = a->value[c];
		} else {
			int32_t span = b->time - a->time; /* > 0: keys are strictly increasing */
			int32_t into = time - a->time;
			for (int c = 0; c < 3; c++) value[c] = a->value[c] + (int32_t)div64((int64_t)(b->value[c] - a->value[c]) * into, span);
		}
	}
	switch (track->property) {
	case GS_ANIM_POSITION:
		for (int c = 0; c < 3; c++) gs_node_state[track->node].position[c] = value[c];
		break;
	case GS_ANIM_ROTATION:
		for (int c = 0; c < 3; c++) gs_node_state[track->node].rotation[c] = value[c];
		break;
	case GS_ANIM_SCALE:
		for (int c = 0; c < 3; c++) gs_node_state[track->node].scale[c] = value[c];
		break;
	case GS_ANIM_VISIBLE:
		gs_node_state[track->node].visible = value[0] != 0;
		break;
	case GS_ANIM_VOLUME:
		gs_audio_set_volume(gs_scene.nodes[track->node].audio, value[0]);
		break;
	default:
		gs_audio_set_pitch(gs_scene.nodes[track->node].audio, value[0]);
		break;
	}
}

static void apply_animation(const GsAnimation *animation, int32_t time) {
	for (int t = 0; t < animation->trackCount; t++) apply_track(&gs_scene.animTracks[animation->trackStart + t], time);
}

int gs_node_anim_player(int node) { return gs_scene.nodes[node].animPlayer; }

void gs_anim_play(int player, int animation) {
	if (player < 0 || !anim_state || animation < 0 || animation >= gs_scene.animationPlayers[player].animationCount) return;
	anim_state[player].anim = animation;
	anim_state[player].time = 0;
	anim_state[player].playing = 1;
}

void gs_anim_stop(int player) {
	if (player < 0 || !anim_state) return;
	anim_state[player].playing = 0;
}

int gs_anim_is_playing(int player) { return player >= 0 && anim_state && anim_state[player].playing; }
int32_t gs_anim_get_speed(int player) { return player < 0 || !anim_state ? GS_ONE : anim_state[player].speed; }
void gs_anim_set_speed(int player, int32_t speed) {
	if (player < 0 || !anim_state) return;
	anim_state[player].speed = gs_clamp(speed, 205, GS_ONE * 10) /* 0.05 to 10 */;
}

void gs_init_animation(void) {
	if (gs_scene.animationPlayerCount == 0) return;
	anim_state = malloc(sizeof(AnimState) * gs_scene.animationPlayerCount);
	for (int i = 0; i < gs_scene.animationPlayerCount; i++) {
		anim_state[i].anim = -1;
		anim_state[i].time = 0;
		anim_state[i].speed = gs_scene.animationPlayers[i].speed;
		anim_state[i].playing = 0;
		if (gs_scene.animationPlayers[i].autoplay >= 0) gs_anim_play(i, gs_scene.animationPlayers[i].autoplay);
	}
}

void gs_update_animation(int32_t delta) {
	if (!anim_state) return;
	for (int i = 0; i < gs_scene.animationPlayerCount; i++) {
		AnimState *state = &anim_state[i];
		if (!state->playing) continue;
		const GsAnimation *animation = &gs_scene.animations[gs_scene.animationPlayers[i].animationStart + state->anim];
		state->time += (int32_t)(((int64_t)delta * state->speed) >> 12);
		if (state->time >= animation->length) {
			if (animation->loop && animation->length > 0) {
				state->time %= animation->length;
			} else {
				state->time = animation->length;
				state->playing = 0; /* it stops on its last frame, which is applied below */
			}
		}
		apply_animation(animation, state->time);
	}
}
