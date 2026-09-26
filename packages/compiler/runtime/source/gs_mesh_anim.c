/*
 * Frame animations of 3D models with several poses (requirements/scene-designer/STORY.animated-3d-models.md): which pose of each animated mesh is showing, moved on once a game frame
 * (the stepper is the one the animated sprites use), and what a script's play(), stop() and is_playing() do to it. The mesh is drawn with the pose's own vertex table.
 */
#include <stdlib.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "scene.h"
#include "gs_sprite_anim.h"

static GsSpriteAnimState *state; /* one for each mesh of the scene */

void gs_mesh_anim_reset(void) {
	free(state);
	state = 0;
}

void gs_init_mesh_anim(void) {
	gs_mesh_anim_reset();
	if (gs_scene.meshCount == 0) return;
	state = calloc(gs_scene.meshCount, sizeof(GsSpriteAnimState));
	for (int i = 0; i < gs_scene.meshCount; i++) {
		const GsMesh *mesh = &gs_scene.meshes[i];
		state[i].animation = -1;
		if (mesh->frameCount > 0 && mesh->animation >= 0) gs_anim_start(&state[i], gs_scene.meshAnimations, mesh->animation);
	}
}

/* One game frame: every animation that is playing moves on. */
void gs_update_mesh_anim(void) {
	if (!state) return;
	for (int i = 0; i < gs_scene.meshCount; i++) {
		if (gs_scene.meshes[i].frameCount > 0) gs_anim_step(&state[i], gs_scene.meshAnimations);
	}
}

/* The primitive (vertex table) mesh `i` is drawn with right now. */
int gs_mesh_primitive(int i) {
	const GsMesh *mesh = &gs_scene.meshes[i];
	if (mesh->frameCount == 0 || !state) return mesh->primitive;
	const unsigned pose = state[i].frame < mesh->frameCount ? state[i].frame : 0;
	return gs_scene.meshFrames[mesh->frameStart + pose];
}

/* The animated mesh that a node draws, or -1. */
static int mesh_of_node(int node) {
	for (int i = 0; i < gs_scene.meshCount; i++) {
		if (gs_scene.meshes[i].node == node && gs_scene.meshes[i].frameCount > 0) return i;
	}
	return -1;
}

/* `animation` counts among the animations the mesh has, in the order of the node's list (what a script's play("name") resolved to). */
void gs_mesh_play(int node, int animation) {
	const int i = mesh_of_node(node);
	if (i < 0 || !state) return;
	const GsMesh *mesh = &gs_scene.meshes[i];
	if (animation < 0 || animation >= mesh->animationCount) return;
	gs_anim_start(&state[i], gs_scene.meshAnimations, mesh->animationFirst + animation);
}

void gs_mesh_stop(int node) {
	const int i = mesh_of_node(node);
	if (i >= 0 && state) state[i].playing = 0;
}

int gs_mesh_is_playing(int node) {
	const int i = mesh_of_node(node);
	return i >= 0 && state && state[i].playing;
}
