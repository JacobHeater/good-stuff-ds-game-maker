/*
 * Safe no-op implementations of the parts of gs_api.h a standalone 2D project can't do anything with yet: an
 * AnimationPlayer, TouchArea2D, 3D-only solid-body collision and raycasting, 3D mesh animation, and saving the game.
 * (Sound and overlaps() are real now -- gs_runtime2d.c.) A 2D script that calls one of the still-stubbed functions
 * below compiles and runs exactly as if it had reached a 3D AnimationPlayer-less node -- nothing happens, nothing
 * breaks. Each one becomes a real feature of its own, replacing its stub here, as that story is built.
 *
 * Requirements: requirements/scene-designer/STORY.standalone-2d-scripting.md, EPIC.full-2d-games.md.
 */
#include "gs_api.h"

/* ---- A 2D project never has a 3D scene on the touch screen. */
int32_t gs_touch_ground(int axis, int32_t plane_y) {
	(void)axis;
	(void)plane_y;
	return 0;
}

/* ---- TouchArea2D isn't built for 2D yet (it still draws and checks-in fine; the ROM just never reports a touch on one). */
int gs_touch_state(int node, int which) {
	(void)node;
	(void)which;
	return 0;
}

/* ---- A 2D project has CollisionShape2D (overlaps() is real -- gs_runtime2d.c) but no solid-body movement system yet: there's no
   CollisionShape3D to make a script's move_and_collide()/is_on_floor() etc. resolve at all, so these can never actually be
   reached -- stubbed only so the link always succeeds if that ever changes. */
int gs_move_and_collide(int body, int32_t dx, int32_t dy, int32_t dz) {
	(void)body;
	(void)dx;
	(void)dy;
	(void)dz;
	return 0;
}
int gs_probe_solid(int body, int32_t y, int32_t x0, int32_t x1, int32_t x2) {
	(void)body;
	(void)y;
	(void)x0;
	(void)x1;
	(void)x2;
	return 0;
}
int32_t gs_ray_cast(int body, int32_t ox, int32_t oy, int32_t oz, int32_t dx, int32_t dy, int32_t dz, int32_t max) {
	(void)body;
	(void)ox;
	(void)oy;
	(void)oz;
	(void)dx;
	(void)dy;
	(void)dz;
	(void)max;
	return -4096; /* -1.0 in f32: no hit */
}
int gs_body_state(int body, int mask) {
	(void)body;
	(void)mask;
	return 0;
}

/* ---- AnimationPlayer isn't built for 2D yet: no node ever gets a real player index. */
int gs_node_anim_player(int node) {
	(void)node;
	return -1;
}
void gs_anim_play(int player, int animation) {
	(void)player;
	(void)animation;
}
void gs_anim_stop(int player) { (void)player; }
int gs_anim_is_playing(int player) {
	(void)player;
	return 0;
}
int32_t gs_anim_get_speed(int player) {
	(void)player;
	return GS_ONE;
}
void gs_anim_set_speed(int player, int32_t speed) {
	(void)player;
	(void)speed;
}

/* ---- A 2D project has no MeshInstance3D, so a script can never actually reach these -- stubbed only so the link always succeeds. */
void gs_mesh_play(int node, int animation) {
	(void)node;
	(void)animation;
}
void gs_mesh_stop(int node) { (void)node; }
int gs_mesh_is_playing(int node) {
	(void)node;
	return 0;
}

/* ---- Saving isn't built for 2D yet: there is never a save to find or write. */
int gs_save_game(void) { return 0; }
int gs_load_game(void) { return 0; }
int gs_has_save(void) { return 0; }
