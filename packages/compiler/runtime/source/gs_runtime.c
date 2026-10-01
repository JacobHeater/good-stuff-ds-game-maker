/*
 * The runtime's services for scripts and drawing: the node table's live state and per-frame transforms, buttons and touch, and sound
 * control. Split from main.c so a test program can link it without the renderer (see packages/compiler/src/testing/script-semantics.rom.test.ts).
 *
 * Requirements: requirements/compiler/TASK.runtime-node-table-and-script-services.md
 */
#include <nds.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

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

/*
 * compose_node's memory. A node's world transform only changes when its own position, rotation or scale does, or its parent's transform did, and a script that moves
 * one block leaves every other node as it was: so what each node was last composed from is kept (its nine numbers, and the version of its parent it saw), and a node
 * whose inputs are the same is not composed again. Composing costs about 0.09 ms on the DS and a move brings up to date every solid shape near the body, which in a
 * tower is all of them: without this a move cost 7 ms in a 30-block tower and now it costs what the blocks that actually moved cost.
 */
typedef struct {
	int32_t in[9]; /* position, rotation, scale: the same order as GsNodeState */
	uint16_t parentVersion;
	uint16_t version; /* changes every time the node is composed */
	uint8_t valid;
} ComposeMemo;
static ComposeMemo *compose_memo;

int gs_pending_scene = -1;
void gs_change_scene(int scene) { gs_pending_scene = scene; }

void gs_init_nodes(void) {
	free(gs_node_state);
	free(gs_world_matrix);
	free(gs_world_scale);
	free(gs_world_visible);
	free(compose_memo);
	int n = gs_scene.nodeCount;
	gs_node_state = malloc(sizeof(GsNodeState) * n);
	gs_world_matrix = malloc(sizeof(GsMatrix) * n);
	gs_world_scale = malloc(sizeof(int32_t[3]) * n);
	gs_world_visible = malloc(n);
	compose_memo = calloc(n, sizeof(ComposeMemo));
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
/* degrees * 32768 / (360 * 4096) is exactly degrees / 45, which is a multiply for the compiler; the 64-bit division it was written as is a library call on the DS (about 700 cycles, six times for every node composed). */
static int16_t angle_of(int32_t degrees) { return (int16_t)(degrees / 45); }
int32_t gs_sin(int32_t degrees) { return sinLerp(angle_of(degrees)); }
int32_t gs_cos(int32_t degrees) { return cosLerp(angle_of(degrees)); }
/* A xorshift generator, seeded from the clock the first time it is asked (a game plays differently each time). */
static uint32_t rng_state;
static uint32_t rng_next(void) {
	if (rng_state == 0) rng_state = ((uint32_t)time(NULL) * 2654435761u) ^ ((uint32_t)REG_VCOUNT << 16) ^ 0x9e3779b9u;
	if (rng_state == 0) rng_state = 1;
	rng_state ^= rng_state << 13;
	rng_state ^= rng_state >> 17;
	rng_state ^= rng_state << 5;
	return rng_state;
}
int32_t gs_randi(int32_t n) { return n <= 0 ? 0 : (int32_t)((rng_next() >> 8) % (uint32_t)n); }
int32_t gs_randf(void) { return (int32_t)(rng_next() >> 20); }

/* The angle of a ratio z in 0..1 (f32), in degrees: z * (45 + 15.64 * (1 - z)), within a quarter of a degree. */
static int32_t atan_unit(int32_t z) { return gs_mulf(z, 45 * GS_ONE + gs_mulf(64061, GS_ONE - z)); }
int32_t gs_atan2(int32_t y, int32_t x) {
	if (x == 0 && y == 0) return 0;
	const int32_t ax = gs_abs(x), ay = gs_abs(y);
	int32_t angle = ax >= ay ? atan_unit(gs_divf(ay, ax)) : 90 * GS_ONE - atan_unit(gs_divf(ax, ay));
	if (x < 0) angle = 180 * GS_ONE - angle;
	return y < 0 ? -angle : angle;
}

int32_t gs_sqrt(int32_t f) { return f <= 0 ? 0 : sqrtf32(f); }

/* Recomputes node `i`'s world transform from its parent's and its own local values, the way the editor composes it:
   rotation is Rx * Ry * Rz (three.js's XYZ Euler order), scale multiplies down the chain, and a node's position is carried
   through its parent's rotation and scale. */

static void compose_node(int i) {
	const GsNodeState *s = &gs_node_state[i];
	ComposeMemo *memo = &compose_memo[i];
	const int parentIndex = gs_scene.nodes[i].parent;
	const uint16_t parentVersion = parentIndex >= 0 ? compose_memo[parentIndex].version : 0;
	if (memo->valid && memo->parentVersion == parentVersion && memcmp(memo->in, s->position, sizeof memo->in) == 0) return;
	memcpy(memo->in, s->position, sizeof memo->in);
	memo->parentVersion = parentVersion;
	memo->version++;
	memo->valid = 1;
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

/* ---- Touch areas ------------------------------------------------------------------------------------------------------------------ */

static uint8_t *touchNow;    /* per touch area: the stylus is on it this frame (and, once a touch has an owner, only the owner says so) */
static uint8_t *touchBefore; /* ... and was on it last frame */
static int touchActive;      /* the stylus has been down since an earlier frame */
static int touchStart;       /* this is the first frame of the touch */
static int touchOwner;       /* the area the touch went down on (the nearest of those under it), or -1: the touch owns nothing */

void gs_init_touch(void) {
	free(touchNow);
	free(touchBefore);
	touchNow = calloc(gs_scene.touchAreaCount + 1, 1);
	touchBefore = calloc(gs_scene.touchAreaCount + 1, 1);
	touchOwner = -1;
}

static inline float f32_to_float(int32_t v) { return (float)v * (1.0f / 4096.0f); }

/* A square root by Newton's method (soft float has no sqrt without libm; this only orders touch areas, so a few steps are plenty). */
static float soft_sqrt(float x) {
	if (x <= 0.0f) return 0.0f;
	float guess = x > 1.0f ? x * 0.5f : 1.0f;
	for (int i = 0; i < 12; i++) guess = 0.5f * (guess + x / guess);
	return guess;
}

/*
 * How far along the ray through the touched screen point (px, py) a box or sphere in the scene is first hit (in the camera's depth: the same number for every shape, so
 * they can be compared), or -1 when the ray misses it. 0 means the camera is inside it. A ray leaves the camera through the point and is tested against the shape in the
 * shape's own space: the camera's view matrix times the node's world matrix (both rotation and translation only) takes the shape's space to the camera's, so
 * the ray's origin and direction are brought into the shape's space with the transpose of the rotation, and divided by the node's scale (the shape scales with
 * the node). Then it is a ray against an axis-aligned box (the slab method) or a sphere at the origin. The DS has no floating point unit, so this is soft float
 * and costs a fraction of a millisecond, but it only runs while the stylus is down. The ray is a half line: a shape behind the camera is not hit.
 */
static float ray_distance(const GsTouchArea *area, int px, int py) {
	GsMatrix view;
	gs_compute_view(&view);
	const int32_t *w = gs_world_matrix[area->node].m;
	const int32_t *v = view.m;
	/* Column-major: element (row r, column c) is m[c * 4 + r]. C = V * W. Only its rotation R and translation t are needed. */
	float R[3][3], t[3];
	for (int r = 0; r < 3; r++) {
		for (int c = 0; c < 3; c++) {
			float sum = 0.0f;
			for (int k = 0; k < 3; k++) sum += f32_to_float(v[k * 4 + r]) * f32_to_float(w[c * 4 + k]);
			R[r][c] = sum;
		}
		float sum = f32_to_float(v[12 + r]);
		for (int k = 0; k < 3; k++) sum += f32_to_float(v[k * 4 + r]) * f32_to_float(w[12 + k]);
		t[r] = sum;
	}
	/* The ray in the camera's space: from the origin, through the point on the screen (the camera looks down -Z). */
	const float nx = 2.0f * ((float)px + 0.5f) / 256.0f - 1.0f;
	const float ny = 1.0f - 2.0f * ((float)py + 0.5f) / 192.0f;
	const float d[3] = { nx * gs_scene.tanHalfFov * (256.0f / 192.0f), ny * gs_scene.tanHalfFov, -1.0f };
	/* Into the shape's space: origin = R^T (0 - t), direction = R^T d, then unscaled. */
	float o[3], e[3];
	for (int j = 0; j < 3; j++) {
		o[j] = -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2]);
		e[j] = R[0][j] * d[0] + R[1][j] * d[1] + R[2][j] * d[2];
		float s = f32_to_float(gs_world_scale[area->node][j]);
		if (s < 0.0f) s = -s;
		if (s < 0.0001f) s = 0.0001f;
		o[j] /= s;
		e[j] /= s;
	}
	if (area->shape == GS_TOUCH_SPHERE) {
		const float r = f32_to_float(area->p[0]);
		const float a = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
		const float b = o[0] * e[0] + o[1] * e[1] + o[2] * e[2];
		const float c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
		const float disc = b * b - a * c;
		if (!(disc >= 0.0f && (c <= 0.0f || b < 0.0f))) return -1.0f;
		if (c <= 0.0f) return 0.0f;
		return (-b - soft_sqrt(disc)) / a;
	}
	float tmin = 0.0f, tmax = 1.0e9f;
	for (int j = 0; j < 3; j++) {
		const float h = f32_to_float(area->p[j]);
		if (e[j] > -1.0e-6f && e[j] < 1.0e-6f) {
			if (o[j] < -h || o[j] > h) return -1.0f; /* parallel to this pair of faces and outside them */
			continue;
		}
		float t1 = (-h - o[j]) / e[j];
		float t2 = (h - o[j]) / e[j];
		if (t1 > t2) { const float swap = t1; t1 = t2; t2 = swap; }
		if (t1 > tmin) tmin = t1;
		if (t2 < tmax) tmax = t2;
		if (tmin > tmax) return -1.0f;
	}
	return tmin;
}

int32_t gs_touch_ground(int axis, int32_t plane_y) {
	if (!gs_touching) return 0;
	GsMatrix view;
	gs_compute_view(&view);
	const int32_t *v = view.m; /* rotation R (element (r, c) is v[c * 4 + r]) and translation t (v[12..14]): world -> camera */
	const float t[3] = { f32_to_float(v[12]), f32_to_float(v[13]), f32_to_float(v[14]) };
	const float nx = 2.0f * ((float)gs_touch_x + 0.5f) / 256.0f - 1.0f;
	const float ny = 1.0f - 2.0f * ((float)gs_touch_y + 0.5f) / 192.0f;
	const float d[3] = { nx * gs_scene.tanHalfFov * (256.0f / 192.0f), ny * gs_scene.tanHalfFov, -1.0f };
	/* The ray in the world: origin = R^T (0 - t) (where the camera is), direction = R^T d. */
	float o[3], w[3];
	for (int j = 0; j < 3; j++) {
		o[j] = 0.0f;
		w[j] = 0.0f;
		for (int i = 0; i < 3; i++) {
			const float r = f32_to_float(v[j * 4 + i]);
			o[j] -= r * t[i];
			w[j] += r * d[i];
		}
	}
	if (w[1] > -1.0e-6f && w[1] < 1.0e-6f) return 0; /* parallel to the plane */
	const float s = (f32_to_float(plane_y) - o[1]) / w[1];
	if (s < 0.0f) return 0; /* the plane is behind the ray */
	float hit = o[axis == 0 ? 0 : 2] + s * w[axis == 0 ? 0 : 2];
	if (hit > 500000.0f) hit = 500000.0f;
	if (hit < -500000.0f) hit = -500000.0f;
	return (int32_t)(hit * 4096.0f);
}

void gs_update_touch(void) {
	for (int i = 0; i < gs_scene.touchAreaCount; i++) {
		touchBefore[i] = touchNow[i];
		touchNow[i] = 0;
	}
	if (!gs_touching) {
		touchActive = 0;
		touchStart = 0;
		touchOwner = -1;
		return;
	}
	touchStart = !touchActive;
	touchActive = 1;

	/* Which areas are under the stylus, and how far away each volume is. */
	uint8_t under[gs_scene.touchAreaCount + 1];
	float away[gs_scene.touchAreaCount + 1];
	for (int i = 0; i < gs_scene.touchAreaCount; i++) {
		const GsTouchArea *area = &gs_scene.touchAreas[i];
		under[i] = 0;
		away[i] = 0.0f;
		if (!gs_world_visible[area->node]) continue;
		if (area->shape == GS_TOUCH_RECT) {
			under[i] = gs_touch_x >= area->rect[0] && gs_touch_x < area->rect[0] + area->rect[2] && gs_touch_y >= area->rect[1] && gs_touch_y < area->rect[1] + area->rect[3];
		} else {
			away[i] = ray_distance(area, gs_touch_x, gs_touch_y);
			under[i] = away[i] >= 0.0f;
		}
	}

	/* A touch goes to one area: when it goes down, the nearest volume under it (or, among rectangles, the last one in the tree, which is drawn on top). It stays with that
	   area until the stylus is lifted, so a block being dragged is not lost to another one that ends up nearer, and only one block is picked up at a time. A touch that
	   went down on no area owns nothing, and then any area it slides over reports it. */
	if (touchStart) {
		touchOwner = -1;
		float nearest = 0.0f;
		for (int i = 0; i < gs_scene.touchAreaCount; i++) {
			if (!under[i]) continue;
			if (gs_scene.touchAreas[i].shape == GS_TOUCH_RECT) {
				if (touchOwner < 0 || gs_scene.touchAreas[touchOwner].shape == GS_TOUCH_RECT) touchOwner = i;
			} else if (touchOwner < 0 || gs_scene.touchAreas[touchOwner].shape == GS_TOUCH_RECT || away[i] < nearest) {
				touchOwner = i;
				nearest = away[i];
			}
		}
	}
	for (int i = 0; i < gs_scene.touchAreaCount; i++) touchNow[i] = under[i] && (touchOwner < 0 || i == touchOwner);
}

int gs_touch_state(int node, int which) {
	if (node < 0 || node >= gs_scene.nodeCount) return 0;
	const int i = gs_scene.nodes[node].touch;
	if (i < 0) return 0;
	switch (which) {
	case GS_TOUCH_HELD: return touchNow[i];
	case GS_TOUCH_PRESSED: return touchNow[i] && touchStart; /* the stylus went down on it this frame (sliding onto it later is not a press) */
	default: return touchBefore[i] && !touchNow[i] && !gs_touching; /* lifted this frame, having been on it the frame before */
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
	free(audioState);
	audioState = 0;
	if (gs_scene.audioPlayerCount == 0) return;
	audioState = malloc(sizeof(AudioState) * gs_scene.audioPlayerCount);
	for (int i = 0; i < gs_scene.audioPlayerCount; i++) {
		const GsAudioPlayer *player = &gs_scene.audioPlayers[i];
		audioState[i].channel = -1;
		audioState[i].volume = (player->volume << 12) / 127;
		/* A player with no sound of its own (named clips only, GsAudioPlayer.sound -1) has nothing to compute a starting
		   pitch from; gs_audio_play_clip sets the real one itself each time it starts a clip. */
		audioState[i].pitch = player->sound >= 0 ? ((int32_t)player->frequency << 12) / gs_scene.sounds[player->sound].sampleRate : GS_ONE;
	}
	soundEnable();
}

static int audio_volume(const AudioState *state) { return (int)gs_clamp((state->volume * 127 + 2048) >> 12, 0, 127); }
static int audio_frequency(const AudioState *state, const GsSound *sound) {
	return (int)gs_clamp(((int64_t)sound->sampleRate * state->pitch) >> 12, 256, 65535);
}

int gs_node_audio_player(int node) { return gs_scene.nodes[node].audio; }

/* Starts `sound` on `player`'s one hardware channel (killing whatever it was already playing), at state->volume/pitch
   (already set by the caller) and `loop`. Shared by gs_audio_play (the player's own sound) and gs_audio_play_clip
   (one of its named clips) -- only one of the two is ever playing on a player at a time, since there is one channel. */
static void audio_start(int player, const GsSound *sound, int loop) {
	AudioState *state = &audioState[player];
	if (state->channel >= 0) soundKill(state->channel);
	/* Centred (pan 64); a loop restarts at the beginning. `format` is a libnds SoundFormat the compiler already picked
	   (16-bit PCM or the DS's own IMA-ADPCM), and `data`/`byteCount` are exactly what that format wants. */
	state->channel = soundPlaySample(sound->data, (SoundFormat)sound->format, sound->byteCount, audio_frequency(state, sound), audio_volume(state), 64, loop != 0, 0);
}

void gs_audio_play(int player) {
	if (player < 0) return;
	const GsAudioPlayer *config = &gs_scene.audioPlayers[player];
	if (config->sound < 0) return; /* no sound of its own (named clips only): nothing for a plain play() to start */
	audio_start(player, &gs_scene.sounds[config->sound], config->loop);
}

/* play("name") on an AudioStreamPlayer with named clips (requirements/audio/STORY.named-audio-clips.md): `clip` is the
   sound's place among this player's own clips (gs_scene.audioPlayers[player].clipStart + clip), resolved at compile
   time the same way play("name") on an AnimationPlayer resolves to an animation index. Its own volume/pitch replace
   whatever the player's channel had, the same way a different animation uses its own loop setting. */
void gs_audio_play_clip(int player, int clip) {
	if (player < 0) return;
	const GsAudioPlayer *config = &gs_scene.audioPlayers[player];
	const GsAudioClip *audioClip = &gs_scene.audioClips[config->clipStart + clip];
	const GsSound *sound = &gs_scene.sounds[audioClip->sound];
	AudioState *state = &audioState[player];
	state->volume = (audioClip->volume << 12) / 127;
	state->pitch = ((int32_t)audioClip->frequency << 12) / sound->sampleRate;
	audio_start(player, sound, audioClip->loop);
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

/* Stops every sound the scene is playing and forgets its players. */
static void audio_shutdown(void) {
	if (!audioState) return;
	for (int i = 0; i < gs_scene.audioPlayerCount; i++) {
		if (audioState[i].channel >= 0) soundKill(audioState[i].channel);
	}
	free(audioState);
	audioState = 0;
}

void gs_collision_reset(void);
void gs_animation_reset(void);
void gs_sprites_reset(void);

void gs_leave_scene(void) {
	audio_shutdown();
	gs_collision_reset();
	gs_animation_reset();
	gs_sprites_reset();
	gs_labels_reset();
	gs_mesh_anim_reset();
}

/* Starts every audio player that has Autoplay on, once, before the first frame. Sound plays on the DS's sound hardware (the ARM7 runs it);
   the samples are constant data in main RAM, which is where the hardware reads them from. */
void gs_start_audio(void) {
	for (int i = 0; i < gs_scene.audioPlayerCount; i++) {
		if (gs_scene.audioPlayers[i].autoplay) gs_audio_play(i);
	}
}
