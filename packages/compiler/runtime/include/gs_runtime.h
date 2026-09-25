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
void gs_init_nodes(void);
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

/* Sets up the animation players and starts the Autoplay animations; and the per-frame step (after the scripts, before gs_update_nodes): advance every playing
   animation by `delta` (f32 seconds) times its speed and write what its tracks say into the nodes. */
void gs_init_animation(void);
void gs_update_animation(int32_t delta);

/* Sets up the audio players' state and starts the ones with Autoplay on. */
void gs_init_audio(void);
void gs_start_audio(void);

#endif
