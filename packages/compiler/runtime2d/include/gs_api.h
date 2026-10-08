/*
 * What generated script code (source/script_code2d.c, written by the compiler from the project's scripts) may use of the 2D
 * runtime. The generated code is identical either way, since the checker/codegen (checker.ts, script-codegen.ts) are the same
 * for a 2D project as for a 3D one's 2D screen -- this header just gives the 2D runtime the same names to implement.
 *
 * Several of these aren't real yet (sound, an AnimationPlayer, switching scenes, saving) -- see gs_stubs2d.c, where each is a
 * documented, safe no-op until its own story builds it for real, exactly the way `play()` on a 3D AudioStreamPlayer with no
 * sound already does nothing rather than failing. A 2D project simply never has a node with a real index for any of these
 * yet, so every call into them is always the "nothing to do" case.
 *
 * Numbers: a script `int` is int32_t, a `float` is int32_t in the DS's 20.12 fixed point (1.0 is 4096), a `bool` is int.
 * Requirements: requirements/scene-designer/STORY.standalone-2d-scripting.md.
 */
#ifndef GS_API_H
#define GS_API_H

#include <stdint.h>

/* ---- Fixed-point helpers (inline so the generated code is as fast as hand-written). Identical to the 3D runtime's. */

#define GS_ONE 4096

static inline int32_t gs_mulf(int32_t a, int32_t b) { return (int32_t)(((int64_t)a * b) >> 12); }
static inline int32_t gs_divf(int32_t a, int32_t b) { return b == 0 ? 0 : (int32_t)(((int64_t)a << 12) / b); }
static inline int32_t gs_divi(int32_t a, int32_t b) {
	if (b == 0) return 0;
	if (b == -1) return (int32_t)(0u - (uint32_t)a);
	return a / b;
}
static inline int32_t gs_modi(int32_t a, int32_t b) { return (b == 0 || b == -1) ? 0 : a % b; }
static inline int32_t gs_i2f(int32_t i) { return (int32_t)((uint32_t)i << 12); }
static inline int32_t gs_f2i(int32_t f) { return f / GS_ONE; }
static inline int32_t gs_abs(int32_t a) { return a < 0 ? (int32_t)(0u - (uint32_t)a) : a; }
static inline int32_t gs_min(int32_t a, int32_t b) { return a < b ? a : b; }
static inline int32_t gs_max(int32_t a, int32_t b) { return a > b ? a : b; }
static inline int32_t gs_clamp(int32_t v, int32_t lo, int32_t hi) { return v < lo ? lo : (v > hi ? hi : v); }
int32_t gs_sqrt(int32_t f);
int32_t gs_sin(int32_t degrees);
int32_t gs_cos(int32_t degrees);
int32_t gs_randi(int32_t n);
int32_t gs_randf(void);
int32_t gs_atan2(int32_t y, int32_t x);

/* ---- Nodes: what a script reads and writes. The runtime keeps one per node a script can reach (gs_init_nodes2d, gs_runtime2d.c). */
typedef struct {
	int32_t position[3]; /* f32; only [0] (x) and [1] (y) are meaningful for a 2D node */
	int32_t rotation[3]; /* degrees, f32; only [2] is meaningful */
	int32_t scale[3];    /* f32; only [0] (x) and [1] (y) are meaningful */
	uint8_t visible;
} GsNodeState;

extern GsNodeState *gs_node_state;

/* ---- Buttons and touch, read once per frame before the scripts run. Masks match libnds's KEY_* bits. Real (gs_runtime2d.c). */
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

/* ---- Sound. Not built for 2D yet (gs_stubs2d.c): every call is a no-op, `gs_node_audio_player` always -1. */
int gs_node_audio_player(int node);
void gs_audio_play(int player);
void gs_audio_play_clip(int player, int clip);
void gs_audio_stop(int player);
int32_t gs_audio_get_volume(int player);
void gs_audio_set_volume(int player, int32_t volume);
int32_t gs_audio_get_pitch(int player);
void gs_audio_set_pitch(int player, int32_t pitch);

/* ---- Only meaningful when a 3D scene is on the touch screen; a 2D project never has one. Stubbed to 0 (gs_stubs2d.c). */
int32_t gs_touch_ground(int axis, int32_t plane_y);

/* ---- Touch areas. Not built for 2D yet (gs_stubs2d.c, TouchArea2D): always false. */
#define GS_TOUCH_HELD     0
#define GS_TOUCH_PRESSED  1
#define GS_TOUCH_RELEASED 2
int gs_touch_state(int node, int which);

/* ---- Collision. A 2D project has no CollisionShape3D to check these against, so a script can never actually call them -- stubbed anyway (gs_stubs2d.c) so the link always succeeds. */
int gs_overlaps(int a, int b);
#define GS_BODY_FLOOR   1
#define GS_BODY_WALL    2
#define GS_BODY_CEILING 4
int gs_move_and_collide(int body, int32_t dx, int32_t dy, int32_t dz);
int gs_probe_solid(int body, int32_t y, int32_t x0, int32_t x1, int32_t x2);
int32_t gs_ray_cast(int body, int32_t ox, int32_t oy, int32_t oz, int32_t dx, int32_t dy, int32_t dz, int32_t max);
int gs_body_state(int body, int mask);

/* ---- Tile maps (TileMap). Real (gs_runtime2d.c). `node` is the TileMap's place in GsScene2D.nodes; x, y are world-space
   pixels (f32), the same space a node's own position is in. A node that isn't a TileMap, or one with no tile under that
   position, is never solid. */
int gs_tile_solid(int node, int32_t x, int32_t y);

/* ---- Animation (AnimationPlayer). Not built for 2D yet (gs_stubs2d.c): every call is a no-op, `gs_node_anim_player` always -1. */
int gs_node_anim_player(int node);
void gs_anim_play(int player, int animation);
void gs_anim_stop(int player);
int gs_anim_is_playing(int player);
int32_t gs_anim_get_speed(int player);
void gs_anim_set_speed(int player, int32_t speed);

/* ---- Sprite animation (AnimatedSprite2D). Real (gs_runtime2d.c). `node` is the sprite's place in GsScene2D.nodes; `animation`
   counts among that node's own animations, in the order of its list. A node that isn't drawn as a sprite is a no-op. */
void gs_sprite_play(int node, int animation);
void gs_sprite_stop(int node);
int gs_sprite_is_playing(int node);

/* ---- Global variables. Real (script_code2d.c, written by the compiler): `gs_global` holds the project's global variables,
   one 32-bit number each, in the order script_code2d.c lists them. Saving them to the DS's save memory isn't built for 2D
   yet, so gs_save_game/gs_load_game/gs_has_save are stubs that always say there is no save (gs_stubs2d.c). */
extern int32_t gs_global[];
extern const int32_t gs_global_initial[];
extern const uint16_t gs_global_count;
extern const uint32_t gs_global_signature;
int gs_save_game(void);
int gs_load_game(void);
int gs_has_save(void);

/* ---- Labels. Real (gs_runtime2d.c). `node` is a Label's place in GsScene2D.nodes; a node that isn't a label is a no-op. */
void gs_label_set_value(int node, int32_t value);
int32_t gs_label_get_value(int node);
void gs_label_set_text(int node, const char *text);

/* ---- A 2D project has no MeshInstance3D, so a script can never call these -- stubbed anyway (gs_stubs2d.c) so the link always succeeds. */
void gs_mesh_play(int node, int animation);
void gs_mesh_stop(int node);
int gs_mesh_is_playing(int node);

/* ---- Scenes. Switching isn't built for 2D yet: only the starting scene is ever in the ROM (translate-scene-2d.ts's
   extra-scenes-not-built warning), so gs_change_scene is real but nothing ever reads gs_pending_scene (gs_runtime2d.c). */
void gs_change_scene(int scene);
extern int gs_pending_scene;

/* ---- The table the runtime walks each frame: one entry per script attached to a node, in node-table order. Real (script_code2d.c). */
typedef struct {
	void (*ready)(int inst);
	void (*process)(int inst, int32_t delta);
	uint16_t node;
	uint16_t inst;
} GsScriptInstance;

extern const GsScriptInstance gs_script_instances[];
extern const uint16_t gs_script_instance_count;
void gs_scripts_reset(void);

#endif
