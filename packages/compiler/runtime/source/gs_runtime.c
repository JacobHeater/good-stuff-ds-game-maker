/*
 * The runtime's services for scripts and drawing: the node table's live state and per-frame transforms, buttons and touch, and sound
 * control. Split from main.c so a test program can link it without the renderer (see packages/compiler/src/testing/script-semantics.rom.test.ts).
 *
 * Requirements: requirements/compiler/TASK.runtime-node-table-and-script-services.md
 */
#include <nds.h>
#include <stdlib.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "scene.h"

/* ---- Nodes ----------------------------------------------------------------------------------------------------------------------- */

/* What scripts read and write, per node. */
GsNodeState *gs_node_state;
/* Where each node is in the world (rotation + translation, and scale kept apart: see draw_mesh), and whether it is drawn. Static nodes keep
   the compiler's baked values; the dynamic ones are recomputed every frame. */
GsMatrix *gs_world_matrix;
int32_t (*gs_world_scale)[3];
uint8_t *gs_world_visible;

void gs_init_nodes(void) {
	int n = gs_scene.nodeCount;
	gs_node_state = malloc(sizeof(GsNodeState) * n);
	gs_world_matrix = malloc(sizeof(GsMatrix) * n);
	gs_world_scale = malloc(sizeof(int32_t[3]) * n);
	gs_world_visible = malloc(n);
	for (int i = 0; i < n; i++) {
		const GsNode *node = &gs_scene.nodes[i];
		for (int a = 0; a < 3; a++) {
			gs_node_state[i].position[a] = node->position[a];
			gs_node_state[i].rotation[a] = node->rotation[a];
			gs_node_state[i].scale[a] = node->scale[a];
			gs_world_scale[i][a] = node->worldScale[a];
		}
		gs_node_state[i].visible = node->visible;
		gs_world_matrix[i] = node->world;
		gs_world_visible[i] = 1;
	}
}

/* Angles in degrees as a 20.12 number to libnds's 15-bit angle (32768 = a full turn). The cast wraps, which is what a turn should do. */
static int16_t angle_of(int32_t degrees) { return (int16_t)(((int64_t)degrees * 32768) / (360 * 4096)); }
int32_t gs_sin(int32_t degrees) { return sinLerp(angle_of(degrees)); }
int32_t gs_cos(int32_t degrees) { return cosLerp(angle_of(degrees)); }
int32_t gs_sqrt(int32_t f) { return f <= 0 ? 0 : sqrtf32(f); }

/* Recomputes node `i`'s world transform from its parent's and its own local values, the way the editor composes it:
   rotation is Rx * Ry * Rz (three.js's XYZ Euler order), scale multiplies down the chain, and a node's position is carried
   through its parent's rotation and scale. */
static void compose_node(int i) {
	const GsNodeState *s = &gs_node_state[i];
	int32_t sa = gs_sin(s->rotation[0]), ca = gs_cos(s->rotation[0]);
	int32_t sb = gs_sin(s->rotation[1]), cb = gs_cos(s->rotation[1]);
	int32_t sc = gs_sin(s->rotation[2]), cc = gs_cos(s->rotation[2]);
	/* This node's own rotation, r[row][col]. */
	int32_t r[3][3];
	r[0][0] = gs_mulf(cb, cc);
	r[0][1] = -gs_mulf(cb, sc);
	r[0][2] = sb;
	r[1][0] = gs_mulf(ca, sc) + gs_mulf(gs_mulf(sa, sb), cc);
	r[1][1] = gs_mulf(ca, cc) - gs_mulf(gs_mulf(sa, sb), sc);
	r[1][2] = -gs_mulf(sa, cb);
	r[2][0] = gs_mulf(sa, sc) - gs_mulf(gs_mulf(ca, sb), cc);
	r[2][1] = gs_mulf(sa, cc) + gs_mulf(gs_mulf(ca, sb), sc);
	r[2][2] = gs_mulf(ca, cb);

	/* The parent's rotation, scale and position (the root has none: the identity). */
	int32_t p[3][3] = { { GS_ONE, 0, 0 }, { 0, GS_ONE, 0 }, { 0, 0, GS_ONE } };
	int32_t ps[3] = { GS_ONE, GS_ONE, GS_ONE };
	int32_t pt[3] = { 0, 0, 0 };
	int parent = gs_scene.nodes[i].parent;
	if (parent >= 0) {
		const int32_t *pm = gs_world_matrix[parent].m;
		for (int col = 0; col < 3; col++)
			for (int row = 0; row < 3; row++) p[row][col] = pm[col * 4 + row];
		for (int a = 0; a < 3; a++) {
			ps[a] = gs_world_scale[parent][a];
			pt[a] = pm[12 + a];
		}
	}

	int32_t *m = gs_world_matrix[i].m;
	for (int col = 0; col < 3; col++) {
		for (int row = 0; row < 3; row++) {
			int64_t sum = 0;
			for (int k = 0; k < 3; k++) sum += (int64_t)p[row][k] * r[k][col];
			m[col * 4 + row] = (int32_t)(sum >> 12);
		}
		m[col * 4 + 3] = 0;
	}
	/* position = parent position + parent rotation * (parent scale * local position) */
	int32_t v[3];
	for (int a = 0; a < 3; a++) v[a] = gs_mulf(ps[a], s->position[a]);
	for (int row = 0; row < 3; row++) {
		int64_t sum = 0;
		for (int k = 0; k < 3; k++) sum += (int64_t)p[row][k] * v[k];
		m[12 + row] = pt[row] + (int32_t)(sum >> 12);
	}
	m[15] = GS_ONE;
	for (int a = 0; a < 3; a++) gs_world_scale[i][a] = gs_mulf(ps[a], s->scale[a]);
}

/* Visibility and dynamic transforms for every node, parents first (the table's order). */
void gs_update_nodes(void) {
	for (int i = 0; i < gs_scene.nodeCount; i++) {
		const GsNode *node = &gs_scene.nodes[i];
		gs_world_visible[i] = gs_node_state[i].visible && (node->parent < 0 || gs_world_visible[node->parent]);
		if (node->dynamic) compose_node(i);
	}
}

/* One node brought up to date, parents first: its visibility, and its world transform when it is dynamic. */
void gs_refresh_node(int node) {
	const GsNode *n = &gs_scene.nodes[node];
	if (n->parent >= 0) gs_refresh_node(n->parent);
	gs_world_visible[node] = gs_node_state[node].visible && (n->parent < 0 || gs_world_visible[n->parent]);
	if (n->dynamic) compose_node(node);
}

void gs_recompute_node(int node) {
	if (gs_scene.nodes[node].dynamic) compose_node(node);
}

void gs_refresh_subtree(int root) {
	gs_refresh_node(root);
	for (int i = root + 1; i < gs_scene.nodeCount; i++) {
		int under = 0;
		for (int p = gs_scene.nodes[i].parent; p >= 0; p = gs_scene.nodes[p].parent) {
			if (p == root) {
				under = 1;
				break;
			}
		}
		if (!under) continue;
		gs_world_visible[i] = gs_node_state[i].visible && gs_world_visible[gs_scene.nodes[i].parent];
		if (gs_scene.nodes[i].dynamic) compose_node(i);
	}
}

/* The camera's view (world -> camera): the scene's baked one, or (for a camera a script can move) the inverse of its node's rotation and
   translation. The camera's scale is ignored, as the compiler ignores it. */
void gs_compute_view(GsMatrix *out) {
	const GsNode *node = &gs_scene.nodes[gs_scene.cameraNode];
	if (!node->dynamic) {
		*out = gs_scene.view;
		return;
	}
	const int32_t *w = gs_world_matrix[gs_scene.cameraNode].m;
	for (int col = 0; col < 3; col++)
		for (int row = 0; row < 3; row++) out->m[col * 4 + row] = w[row * 4 + col]; /* the transpose of the rotation */
	for (int row = 0; row < 3; row++) {
		int64_t sum = (int64_t)w[row * 4 + 0] * w[12] + (int64_t)w[row * 4 + 1] * w[13] + (int64_t)w[row * 4 + 2] * w[14];
		out->m[12 + row] = -(int32_t)(sum >> 12);
	}
	out->m[3] = out->m[7] = out->m[11] = 0;
	out->m[15] = GS_ONE;
}

/* ---- Buttons and touch ------------------------------------------------------------------------------------------------------------ */

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

/* ---- Sound ------------------------------------------------------------------------------------------------------------------------ */

/* A player's live state: the sound hardware channel it is playing on (-1 when it isn't), and the volume and pitch a script can change. */
typedef struct {
	int channel;
	int32_t volume; /* f32, 0..1 */
	int32_t pitch;  /* f32, 0.25..4 */
} AudioState;
static AudioState *audioState;

void gs_init_audio(void) {
	if (gs_scene.audioPlayerCount == 0) return;
	audioState = malloc(sizeof(AudioState) * gs_scene.audioPlayerCount);
	for (int i = 0; i < gs_scene.audioPlayerCount; i++) {
		const GsAudioPlayer *player = &gs_scene.audioPlayers[i];
		const GsSound *sound = &gs_scene.sounds[player->sound];
		audioState[i].channel = -1;
		audioState[i].volume = (player->volume << 12) / 127;
		audioState[i].pitch = ((int32_t)player->frequency << 12) / sound->sampleRate;
	}
	soundEnable();
}

static int audio_volume(const AudioState *state) { return (int)gs_clamp((state->volume * 127 + 2048) >> 12, 0, 127); }
static int audio_frequency(const AudioState *state, const GsSound *sound) {
	return (int)gs_clamp(((int64_t)sound->sampleRate * state->pitch) >> 12, 256, 65535);
}

int gs_node_audio_player(int node) { return gs_scene.nodes[node].audio; }

void gs_audio_play(int player) {
	if (player < 0) return;
	const GsAudioPlayer *config = &gs_scene.audioPlayers[player];
	const GsSound *sound = &gs_scene.sounds[config->sound];
	AudioState *state = &audioState[player];
	if (state->channel >= 0) soundKill(state->channel);
	/* 16-bit PCM, centred; a loop restarts at sample 0. */
	state->channel = soundPlaySample(sound->samples, SoundFormat_16Bit, sound->sampleCount * 2, audio_frequency(state, sound), audio_volume(state), 64, config->loop != 0, 0);
}

void gs_audio_stop(int player) {
	if (player < 0) return;
	AudioState *state = &audioState[player];
	if (state->channel >= 0) soundKill(state->channel);
	state->channel = -1;
}

int32_t gs_audio_get_volume(int player) { return player < 0 ? 0 : audioState[player].volume; }
int32_t gs_audio_get_pitch(int player) { return player < 0 ? GS_ONE : audioState[player].pitch; }

void gs_audio_set_volume(int player, int32_t volume) {
	if (player < 0) return;
	AudioState *state = &audioState[player];
	state->volume = gs_clamp(volume, 0, GS_ONE);
	if (state->channel >= 0) soundSetVolume(state->channel, audio_volume(state));
}

void gs_audio_set_pitch(int player, int32_t pitch) {
	if (player < 0) return;
	AudioState *state = &audioState[player];
	state->pitch = gs_clamp(pitch, GS_ONE / 4, GS_ONE * 4);
	if (state->channel >= 0) soundSetFreq(state->channel, audio_frequency(state, &gs_scene.sounds[gs_scene.audioPlayers[player].sound]));
}

/* Starts every audio player that has Autoplay on, once, before the first frame. Sound plays on the DS's sound hardware (the ARM7 runs it);
   the samples are constant data in main RAM, which is where the hardware reads them from. */
void gs_start_audio(void) {
	for (int i = 0; i < gs_scene.audioPlayerCount; i++) {
		if (gs_scene.audioPlayers[i].autoplay) gs_audio_play(i);
	}
}
