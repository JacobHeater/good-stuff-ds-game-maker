/*
 * The 2D runtime's services for scripts: the node table's live state, and buttons and touch. Split from main.c the same way
 * gs_runtime.c is split from the 3D runtime's main.c, so a future script-semantics test could link this without the renderer.
 *
 * A 2D project's nodes have no parent chain to compose (translate-scene-2d.ts: a Sprite2D/Label's position is always
 * absolute screen pixels), so there is nothing here like the 3D runtime's world-matrix recomposition -- gs_node_state is
 * simply initialized from GsScene2D.nodes once, and a script writes straight into it; the sprite/label code in main.c reads
 * it back every frame for whichever ones are marked dynamic.
 *
 * Requirements: requirements/scene-designer/STORY.standalone-2d-scripting.md.
 */
#include <nds.h>
#include <stdlib.h>

#include "gs_api.h"
#include "scene2d.h"
#include "gs_tilemap.h"

/* ---- Nodes ------------------------------------------------------------------------------------------------------------------- */

GsNodeState *gs_node_state;

void gs_init_nodes2d(void) {
	free(gs_node_state);
	gs_node_state = 0;
	const int n = gs_scene2d.nodeCount;
	if (n == 0) return;
	gs_node_state = malloc(sizeof(GsNodeState) * n);
	for (int i = 0; i < n; i++) {
		const GsNode2D *node = &gs_scene2d.nodes[i];
		for (int a = 0; a < 3; a++) {
			gs_node_state[i].position[a] = node->position[a];
			gs_node_state[i].rotation[a] = node->rotation[a];
			gs_node_state[i].scale[a] = node->scale[a];
		}
		gs_node_state[i].visible = node->visible;
	}
}

/* ---- Buttons and touch -------------------------------------------------------------------------------------------------------- */

uint32_t gs_keys_held, gs_keys_pressed, gs_keys_released;
int32_t gs_touching, gs_touch_x, gs_touch_y;

void gs_read_input(void) {
	scanKeys();
	gs_keys_held = keysHeld();
	gs_keys_pressed = keysDown();
	gs_keys_released = keysUp();
	touchPosition touch;
	if (touchRead(&touch)) {
		gs_touching = 1;
		gs_touch_x = touch.px;
		gs_touch_y = touch.py;
	} else {
		gs_touching = 0;
		gs_touch_x = 0;
		gs_touch_y = 0;
	}
}

/* ---- Scenes -------------------------------------------------------------------------------------------------------------------
   Real, but inert: a 2D ROM only ever holds its starting scene (translate-scene-2d.ts's extra-scenes-not-built warning), so
   nothing in main.c's loop reads gs_pending_scene yet. A script's change_scene() still compiles and runs; it just doesn't (yet)
   switch anything, the same honest "not built" the node itself already warns about for an AnimationPlayer. */
int gs_pending_scene = -1;
void gs_change_scene(int scene) { gs_pending_scene = scene; }

/* ---- Sound --------------------------------------------------------------------------------------------------------------------
   A direct port of the 3D runtime's own gs_runtime.c sound section. The only real difference is gs_node_audio_player: the 3D
   runtime stores an audio index directly on every node-table entry, but a 2D node table only ever holds what GsNodeState needs
   (position/rotation/scale/visible -- STORY.standalone-2d-scripting.md), so a player is found by searching GsScene2D.audioPlayers
   for the one whose own `node` field matches, the same way main.c's find_sprite/find_label already work. */

typedef struct {
	int channel;    /* the sound hardware channel it is playing on, or -1 */
	int32_t volume; /* f32, 0..1 */
	int32_t pitch;  /* f32, 0.25..4 */
} AudioState2D;
static AudioState2D *audioState;

void gs_init_audio2d(void) {
	free(audioState);
	audioState = 0;
	if (gs_scene2d.audioPlayerCount == 0) return;
	audioState = malloc(sizeof(AudioState2D) * gs_scene2d.audioPlayerCount);
	for (int i = 0; i < gs_scene2d.audioPlayerCount; i++) {
		const GsAudioPlayer *player = &gs_scene2d.audioPlayers[i];
		audioState[i].channel = -1;
		audioState[i].volume = (player->volume << 12) / 127;
		audioState[i].pitch = player->sound >= 0 ? ((int32_t)player->frequency << 12) / gs_scene2d.sounds[player->sound].sampleRate : GS_ONE;
	}
	soundEnable();
}

/* Starts every audio player that has Autoplay on, once, before the first frame (main.c, alongside every script's _ready()). */
void gs_start_audio2d(void) {
	for (int i = 0; i < gs_scene2d.audioPlayerCount; i++) {
		if (gs_scene2d.audioPlayers[i].autoplay) gs_audio_play(i);
	}
}

static int audio_volume(const AudioState2D *state) { return (int)gs_clamp((state->volume * 127 + 2048) >> 12, 0, 127); }
static int audio_frequency(const AudioState2D *state, const GsSound *sound) {
	return (int)gs_clamp(((int64_t)sound->sampleRate * state->pitch) >> 12, 256, 65535);
}

int gs_node_audio_player(int node) {
	for (int i = 0; i < gs_scene2d.audioPlayerCount; i++) {
		if (gs_scene2d.audioPlayers[i].node == node) return i;
	}
	return -1;
}

/* Starts `sound` on `player`'s one hardware channel (killing whatever it was already playing). Shared by gs_audio_play (the
   player's own sound) and gs_audio_play_clip (one of its named clips) -- only one of the two is ever playing at a time. */
static void audio_start(int player, const GsSound *sound, int loop) {
	AudioState2D *state = &audioState[player];
	if (state->channel >= 0) soundKill(state->channel);
	state->channel = soundPlaySample(sound->data, (SoundFormat)sound->format, sound->byteCount, audio_frequency(state, sound), audio_volume(state), 64, loop != 0, 0);
}

void gs_audio_play(int player) {
	if (player < 0) return;
	const GsAudioPlayer *config = &gs_scene2d.audioPlayers[player];
	if (config->sound < 0) return; /* no sound of its own (named clips only): nothing for a plain play() to start */
	audio_start(player, &gs_scene2d.sounds[config->sound], config->loop);
}

void gs_audio_play_clip(int player, int clip) {
	if (player < 0) return;
	const GsAudioPlayer *config = &gs_scene2d.audioPlayers[player];
	const GsAudioClip *audioClip = &gs_scene2d.audioClips[config->clipStart + clip];
	const GsSound *sound = &gs_scene2d.sounds[audioClip->sound];
	AudioState2D *state = &audioState[player];
	state->volume = (audioClip->volume << 12) / 127;
	state->pitch = ((int32_t)audioClip->frequency << 12) / sound->sampleRate;
	audio_start(player, sound, audioClip->loop);
}

void gs_audio_stop(int player) {
	if (player < 0) return;
	AudioState2D *state = &audioState[player];
	if (state->channel >= 0) soundKill(state->channel);
	state->channel = -1;
}

int32_t gs_audio_get_volume(int player) { return player < 0 ? 0 : audioState[player].volume; }
int32_t gs_audio_get_pitch(int player) { return player < 0 ? GS_ONE : audioState[player].pitch; }

void gs_audio_set_volume(int player, int32_t volume) {
	if (player < 0) return;
	AudioState2D *state = &audioState[player];
	state->volume = gs_clamp(volume, 0, GS_ONE);
	if (state->channel >= 0) soundSetVolume(state->channel, audio_volume(state));
}

void gs_audio_set_pitch(int player, int32_t pitch) {
	if (player < 0) return;
	AudioState2D *state = &audioState[player];
	state->pitch = gs_clamp(pitch, GS_ONE / 4, GS_ONE * 4);
	if (state->channel >= 0) soundSetFreq(state->channel, audio_frequency(state, &gs_scene2d.sounds[gs_scene2d.audioPlayers[player].sound]));
}

/* ---- Collision (CollisionShape2D) ----------------------------------------------------------------------------------------------
   v1 is overlap detection only (STORY.standalone-2d-collision.md) -- no solid shapes, no move_and_collide, the same way 3D's
   own collision started before STORY.solid-shapes-and-move-and-collide.md. A shape's rect/circle is centered on its node's
   live position (gs_node_state), so a script moving the node moves the shape too, with no extra work. */

static int collider_of_node(int node, int *index) {
	for (int i = 0; i < gs_scene2d.colliderCount; i++) {
		if (gs_scene2d.colliders[i].node == node) {
			*index = i;
			return gs_node_state[node].visible;
		}
	}
	return 0;
}

int gs_overlaps(int a, int b) {
	int ia, ib;
	if (!collider_of_node(a, &ia) || !collider_of_node(b, &ib)) return 0;
	const GsCollider2D *ca = &gs_scene2d.colliders[ia];
	const GsCollider2D *cb = &gs_scene2d.colliders[ib];
	const GsNodeState *sa = &gs_node_state[a];
	const GsNodeState *sb = &gs_node_state[b];
	if (ca->shape == 0 && cb->shape == 0) {
		/* rect-rect: an AABB test (p[0]/p[1] are half the width/height). */
		return gs_abs(sa->position[0] - sb->position[0]) < ca->p[0] + cb->p[0] && gs_abs(sa->position[1] - sb->position[1]) < ca->p[1] + cb->p[1];
	}
	if (ca->shape == 1 && cb->shape == 1) {
		/* circle-circle: centers closer than the sum of the radii. */
		const int32_t dx = sa->position[0] - sb->position[0];
		const int32_t dy = sa->position[1] - sb->position[1];
		const int32_t r = ca->p[0] + cb->p[0];
		return gs_mulf(dx, dx) + gs_mulf(dy, dy) < gs_mulf(r, r);
	}
	/* One circle, one rect: the rect's point nearest the circle's center, compared to the radius. */
	const GsCollider2D *circle = ca->shape == 1 ? ca : cb;
	const GsNodeState *circleState = ca->shape == 1 ? sa : sb;
	const GsCollider2D *rect = ca->shape == 1 ? cb : ca;
	const GsNodeState *rectState = ca->shape == 1 ? sb : sa;
	const int32_t closestX = gs_clamp(circleState->position[0], rectState->position[0] - rect->p[0], rectState->position[0] + rect->p[0]);
	const int32_t closestY = gs_clamp(circleState->position[1], rectState->position[1] - rect->p[1], rectState->position[1] + rect->p[1]);
	const int32_t dx = circleState->position[0] - closestX;
	const int32_t dy = circleState->position[1] - closestY;
	return gs_mulf(dx, dx) + gs_mulf(dy, dy) < gs_mulf(circle->p[0], circle->p[0]);
}

/* ---- Tile maps (STORY.standalone-2d-tilemaps.md) --------------------------------------------------------------------------
   Rendering (uploading tiles, scrolling with a camera) is gs_tilemap.h/main.c's job, since it touches the background
   hardware; this is just the one thing a script can ask about a map, found by node index the same way collider_of_node
   finds a collision shape's own entry. */

int gs_tile_solid(int node, int32_t x, int32_t y) {
	for (int i = 0; i < gs_scene2d.tileMapCount; i++) {
		if (gs_scene2d.tileMaps[i].node == node) return gs_tilemap_solid(&gs_scene2d.tileMaps[i], x, y);
	}
	return 0;
}
