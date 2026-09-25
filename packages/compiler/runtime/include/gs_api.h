/*
 * What generated script code (source/script_code.c, written by the compiler from the project's scripts) may use of the runtime.
 * Requirements: requirements/compiler/TASK.compile-scripts-to-c.md and TASK.runtime-node-table-and-script-services.md.
 *
 * Numbers: a script `int` is int32_t, a `float` is int32_t in the DS's 20.12 fixed point (1.0 is 4096), a `bool` is int.
 * The runtime (source/main.c) implements everything declared here; the generated code only calls it.
 */
#ifndef GS_API_H
#define GS_API_H

#include <stdint.h>

/* ---- Fixed-point helpers (inline so the generated code is as fast as hand-written). */

#define GS_ONE 4096

/* Multiplying two 20.12 numbers, and dividing them, go through 64 bits so they don't overflow half way. */
static inline int32_t gs_mulf(int32_t a, int32_t b) { return (int32_t)(((int64_t)a * b) >> 12); }
static inline int32_t gs_divf(int32_t a, int32_t b) { return b == 0 ? 0 : (int32_t)(((int64_t)a << 12) / b); }
/* Integer division and remainder: by zero gives 0 rather than crashing, and INT_MIN / -1 wraps rather than trapping. */
static inline int32_t gs_divi(int32_t a, int32_t b) {
	if (b == 0) return 0;
	if (b == -1) return (int32_t)(0u - (uint32_t)a);
	return a / b;
}
static inline int32_t gs_modi(int32_t a, int32_t b) { return (b == 0 || b == -1) ? 0 : a % b; }
/* int -> float, and float -> int (drops the fraction toward zero). */
static inline int32_t gs_i2f(int32_t i) { return (int32_t)((uint32_t)i << 12); }
static inline int32_t gs_f2i(int32_t f) { return f / GS_ONE; }
/* The same code serves int and float: both are plain ints, and the compiler converts before calling. */
static inline int32_t gs_abs(int32_t a) { return a < 0 ? (int32_t)(0u - (uint32_t)a) : a; }
static inline int32_t gs_min(int32_t a, int32_t b) { return a < b ? a : b; }
static inline int32_t gs_max(int32_t a, int32_t b) { return a > b ? a : b; }
static inline int32_t gs_clamp(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : (v > hi ? hi : v); }
/* float in, float out: the square root, and the sine and cosine of an angle in degrees (a lookup table, 12 bits of fraction). */
int32_t gs_sqrt(int32_t f);
int32_t gs_sin(int32_t degrees);
int32_t gs_cos(int32_t degrees);

/* ---- Nodes: what a script reads and writes. The runtime keeps one per node in the scene's node table. */
typedef struct {
	int32_t position[3]; /* f32 */
	int32_t rotation[3]; /* degrees, f32 */
	int32_t scale[3];    /* f32 */
	uint8_t visible;
} GsNodeState;

extern GsNodeState *gs_node_state;

/* ---- Buttons and touch, read once per frame before the scripts run. Masks match libnds's KEY_* bits. */
#define GS_KEY_A      (1 << 0)
#define GS_KEY_B      (1 << 1)
#define GS_KEY_SELECT (1 << 2)
#define GS_KEY_START  (1 << 3)
#define GS_KEY_RIGHT  (1 << 4)
#define GS_KEY_LEFT   (1 << 5)
#define GS_KEY_UP     (1 << 6)
#define GS_KEY_DOWN   (1 << 7)
#define GS_KEY_R      (1 << 8)
#define GS_KEY_L      (1 << 9)
#define GS_KEY_X      (1 << 10)
#define GS_KEY_Y      (1 << 11)

extern uint32_t gs_keys_held, gs_keys_pressed, gs_keys_released;
static inline int gs_key_down(uint32_t mask) { return (gs_keys_held & mask) != 0; }
static inline int gs_key_pressed(uint32_t mask) { return (gs_keys_pressed & mask) != 0; }
static inline int gs_key_released(uint32_t mask) { return (gs_keys_released & mask) != 0; }
extern int32_t gs_touching, gs_touch_x, gs_touch_y;

/* ---- Sound. `player` is an audio player's index, from the node it belongs to (-1 when the node has no sound: every call is then a no-op). */
int gs_node_audio_player(int node);
void gs_audio_play(int player);
void gs_audio_stop(int player);
int32_t gs_audio_get_volume(int player); /* f32, 0..1 */
void gs_audio_set_volume(int player, int32_t volume);
int32_t gs_audio_get_pitch(int player); /* f32, 0.25..4 */
void gs_audio_set_pitch(int player, int32_t pitch);

/* ---- Collision (gs_collision.h): whether the collision shapes of two nodes overlap right now. False when either node has no shape or is hidden. */
int gs_overlaps(int a, int b);

/*
 * ---- Bodies (requirements/collision/STORY.solid-shapes-and-move-and-collide.md). A body is a node with collision shapes under it (or one that is a shape).
 * `gs_move_and_collide` moves the body's `position` by (dx, dy, dz) (f32), one axis at a time (Y, then X, then Z), each as far as the body's visible shapes
 * can go without overlapping a visible solid shape that is not under the body; it returns 1 if anything stopped it. `gs_body_state` says what its last
 * move ran into: GS_BODY_FLOOR (blocked moving down), GS_BODY_CEILING (up) or GS_BODY_WALL (sideways).
 */
#define GS_BODY_FLOOR   1
#define GS_BODY_WALL    2
#define GS_BODY_CEILING 4
int gs_move_and_collide(int body, int32_t dx, int32_t dy, int32_t dz);
int gs_body_state(int body, int mask);

/* ---- Animation (requirements/animation/TASK.compile-and-run-animations.md). `player` is an AnimationPlayer's index, from the node it belongs to (-1 when the node has none: every call is then a no-op); `animation` is an index within that player's animations. */
int gs_node_anim_player(int node);
void gs_anim_play(int player, int animation);
void gs_anim_stop(int player);
int gs_anim_is_playing(int player);
int32_t gs_anim_get_speed(int player); /* f32 */
void gs_anim_set_speed(int player, int32_t speed);

/* ---- The table the runtime walks each frame: one entry per script attached to a node, in node-table order. */
typedef struct {
	void (*ready)(int inst);
	void (*process)(int inst, int32_t delta);
	uint16_t node;
	uint16_t inst; /* which copy of the script's variables this node has */
} GsScriptInstance;

extern const GsScriptInstance gs_script_instances[];
extern const uint16_t gs_script_instance_count;

#endif
