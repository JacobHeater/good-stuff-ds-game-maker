/* What main.c (the renderer) needs from source/gs_runtime.c. */
#ifndef GS_RUNTIME_H
#define GS_RUNTIME_H

#include <stdint.h>

#include "scene.h"

/* Live nodes: allocated by gs_init_nodes from the scene's node table. gs_update_nodes recomputes visibility and the world transforms of the
   dynamic nodes, parents first. A node is drawn when gs_world_visible[node] is set. */
extern GsMatrix *gs_world_matrix;
extern int32_t (*gs_world_scale)[3];
extern uint8_t *gs_world_visible;
/* Puts away everything the scene being shown keeps in memory (its sounds, node arrays, touch, sprite and collision state), before another scene is loaded. */
void gs_leave_scene(void);
void gs_init_nodes(void);
/* Forgets what bodies last ran into and the lists built for moves and probes (a scene change does this). */
void gs_collision_reset(void);
void gs_update_nodes(void);
/* Brings one node (and its parents) up to date with what scripts have written so far this frame: what a script needs to see mid-frame. */
void gs_refresh_node(int node);
/* The same for a node and everything under it (parents first): what a body needs after its position has been changed. */
void gs_refresh_subtree(int root);
/* Recomputes one dynamic node's world transform from its own values and its parent's current one (nothing else). */
void gs_recompute_node(int node);

/* The camera's view matrix for this frame. */
void gs_compute_view(GsMatrix *out);

/* Reads the buttons and touch screen for this frame (before the scripts run). */
void gs_read_input(void);

/* Sprites on the 2D screen (the sub engine): gs_init_sprites copies their images into sprite memory and sets them up (a no-op with none); gs_update_sprites hands the
   sprite table to the hardware once a frame, right after the vertical blank. main.c maps VRAM bank D for sprite tiles (and not for textures) when there are sprites. */
void gs_init_sprites(void);
void gs_update_sprites(void);

/* Labels (text) on the 2D screen: gs_init_labels draws them as they start (after gs_init_sprites, with VRAM bank H mapped for the sub engine's background); gs_update_labels once a frame
   draws again if a label was hidden, shown or changed; gs_labels_reset forgets them when the scene is left. */
void gs_init_labels(void);
void gs_update_labels(void);
void gs_labels_reset(void);

/* Frame animations of animated meshes: gs_init_mesh_anim sets each one up (after gs_init_nodes); gs_update_mesh_anim moves them on once a frame (after the scripts); gs_mesh_primitive says which
   vertex table mesh `i` is drawn with now; gs_mesh_anim_reset gives the memory back when the scene is left. */
void gs_init_mesh_anim(void);
void gs_update_mesh_anim(void);
int gs_mesh_primitive(int mesh);
void gs_mesh_anim_reset(void);

/* Touch areas: gs_init_touch sets up their state; gs_update_touch (once a frame, after gs_read_input and before the scripts) works out which ones the stylus is on. */
void gs_init_touch(void);
void gs_update_touch(void);

/* Sets up the animation players and starts the Autoplay animations; and the per-frame step (after the scripts, before gs_update_nodes): advance every playing
   animation by `delta` (f32 seconds) times its speed and write what its tracks say into the nodes. */
void gs_init_animation(void);
void gs_update_animation(int32_t delta);

/* Sets up the audio players' state and starts the ones with Autoplay on. */
void gs_init_audio(void);
void gs_start_audio(void);

#endif
