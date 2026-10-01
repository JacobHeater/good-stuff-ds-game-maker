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
/* A random whole number from 0 to n - 1 (0 when n is 0 or less), a random float from 0 up to 1, and the angle in degrees (f32, -180 to 180) of the direction (x, y), both f32: the arguments are y then x. */
int32_t gs_randi(int32_t n);
int32_t gs_randf(void);
int32_t gs_atan2(int32_t y, int32_t x);

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
/* play("name"): clip is the sound's place among this player's own named clips, resolved at compile time. */
void gs_audio_play_clip(int player, int clip);
void gs_audio_stop(int player);
int32_t gs_audio_get_volume(int player); /* f32, 0..1 */
void gs_audio_set_volume(int player, int32_t volume);
int32_t gs_audio_get_pitch(int player); /* f32, 0.25..4 */
void gs_audio_set_pitch(int player, int32_t pitch);

/* Where the stylus points on the flat (horizontal) plane at world height `plane_y` (f32): the ray from the camera through the touched pixel, met with that plane.
   axis 0 gives the world X, axis 1 the world Z. 0 when the stylus is up or the ray never reaches the plane (looking above the horizon). Only meaningful when the
   3D scene is on the touch screen. */
int32_t gs_touch_ground(int axis, int32_t plane_y);

/* ---- Touch areas (requirements/touch/STORY.touch-areas.md). Whether the stylus is on a TouchArea2D / TouchArea3D node: GS_TOUCH_HELD (touching it now), GS_TOUCH_PRESSED
   (went down on it this frame) or GS_TOUCH_RELEASED (was lifted this frame after touching it). False for a node with no touch area, or a hidden one. */
#define GS_TOUCH_HELD     0
#define GS_TOUCH_PRESSED  1
#define GS_TOUCH_RELEASED 2
int gs_touch_state(int node, int which);

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
/*
 * Which of three points are inside a solid shape that is not under `body`: the points are (x0, y), (x1, y) and (x2, y) in the frame of the body's first collision shape (its
 * centre, its turn and its scale apply, so "y" is up through the shape and x along its longer horizontal side: its Z when a box is longer in Z than in X, its X otherwise), all f32. Bit 0 is set for the first point, bit 1 for the second, bit 2 for the third. What a block asks to
 * find out what it is resting on: points just below its bottom at both ends and in the middle. One call builds the list of solid shapes once for all three points.
 */
int gs_probe_solid(int body, int32_t y, int32_t x0, int32_t x1, int32_t x2);
/*
 * How far along a ray the nearest visible solid shape that is not under `body` is (f32, world units), or -1.0 when none is within `max`. The ray starts at (ox, oy, oz) and goes toward
 * (dx, dy, dz), which need not be a unit vector (all f32). A ray that starts inside a solid shape hits it at 0. Boxes are exact; the other shapes are found to within 0.03 units.
 * Like the probe it uses the shapes as they were placed at the start of the frame.
 */
int32_t gs_ray_cast(int body, int32_t ox, int32_t oy, int32_t oz, int32_t dx, int32_t dy, int32_t dz, int32_t max);
int gs_body_state(int body, int mask);

/* ---- Animation (requirements/animation/TASK.compile-and-run-animations.md). `player` is an AnimationPlayer's index, from the node it belongs to (-1 when the node has none: every call is then a no-op); `animation` is an index within that player's animations. */
int gs_node_anim_player(int node);
void gs_anim_play(int player, int animation);
void gs_anim_stop(int player);
int gs_anim_is_playing(int player);
int32_t gs_anim_get_speed(int player); /* f32 */
void gs_anim_set_speed(int player, int32_t speed);

/* ---- Sprite animation (requirements/scene-designer/STORY.animated-sprites.md). `node` is an AnimatedSprite2D's node index; `animation` counts among that node's own animations, in the order of its list. A node that isn't drawn as a sprite makes every call a no-op. */
void gs_sprite_play(int node, int animation);
void gs_sprite_stop(int node);
int gs_sprite_is_playing(int node);

/* ---- Global variables and the save file (requirements/scripting/STORY.game-state-and-save.md). `gs_global` holds the project's global variables, one 32-bit number each (a float in 20.12, a bool 0 or 1), in
   the order the generated script_code.c lists them; they keep their values when the scene changes. `gs_global_signature` says which globals the game has (a hash of their names and types), so a save from
   another version is not loaded. The three functions return 1 on success (a save existed / was written) and 0 when there is no save memory or no valid save. */
extern int32_t gs_global[];
extern const int32_t gs_global_initial[];
extern const uint16_t gs_global_count;
extern const uint32_t gs_global_signature;
int gs_save_game(void);
int gs_load_game(void);
int gs_has_save(void);

/* ---- Labels (requirements/scene-designer/STORY.labels-and-text.md). `node` is a Label's node index; a node that isn't a label makes every call a no-op. The value shows where the label's text has `{}`;
   `text` must stay valid (a string literal). */
void gs_label_set_value(int node, int32_t value);
int32_t gs_label_get_value(int node);
void gs_label_set_text(int node, const char *text);

/* ---- Frame animations of 3D models with several poses (requirements/scene-designer/STORY.animated-3d-models.md). `node` is a MeshInstance3D's node index; `animation` counts among that node's own animations, in the order of
   its list. A node that isn't an animated mesh makes every call a no-op. */
void gs_mesh_play(int node, int animation);
void gs_mesh_stop(int node);
int gs_mesh_is_playing(int node);

/* ---- Scenes (requirements/scene-designer/STORY.multiple-scenes.md). `scene` is the scene's place in the project's list of scenes (the starting scene is 0). The switch is made when the
   frame ends, so the scripts of the rest of the frame still see the scene they were called in; a call in the last frame of a scene's life is a no-op. */
void gs_change_scene(int scene);
/* The scene a script asked for (-1: none); main.c switches to it when the frame ends. */
extern int gs_pending_scene;

/* ---- The table the runtime walks each frame: one entry per script attached to a node, in node-table order. */
typedef struct {
	void (*ready)(int inst);
	void (*process)(int inst, int32_t delta);
	uint16_t node;
	uint16_t inst; /* which copy of the script's variables this node has */
} GsScriptInstance;

/* One scene's scripts: its instance table (one entry per script attached to a node, in node-table order), how many, and the function that puts every script variable back to where
   the scene starts them. `gs_scene_scripts` has one entry for each scene of the project, in the order of the project's list (the starting scene first). */
typedef struct {
	const GsScriptInstance *instances;
	const uint16_t *count;
	void (*reset)(void);
} GsSceneScripts;
extern const GsSceneScripts gs_scene_scripts[];

#endif
