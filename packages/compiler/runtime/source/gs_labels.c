/*
 * Labels on the 2D screen of a 3D project (the sub engine). The text layer is in gs_labels.h; this follows the labels' nodes (a script can hide or show one) and gives scripts
 * their value and text.
 *
 * Requirements: requirements/scene-designer/STORY.labels-and-text.md
 */
#include <nds.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "scene.h"
#include "gs_labels.h"

static GsLabelScreen screen;

/* The sub engine's background memory is bank H; main.c maps it (and only when the scene has labels). The sprites set the video mode before this runs. */
void gs_init_labels(void) {
	gs_labels_start(&screen, gs_scene.sprites2D.labels, gs_scene.sprites2D.labelCount, 0);
}

/* The scene is left: forget its labels (the next scene sets up its own; its video mode hides the layer). */
void gs_labels_reset(void) {
	screen.count = 0;
}

void gs_update_labels(void) {
	for (int i = 0; i < screen.count; i++) {
		const int node = screen.labels[i].node;
		if (node < 0) continue;
		const uint8_t visible = gs_node_state[node].visible != 0;
		if (visible != screen.shown[i]) {
			screen.shown[i] = visible;
			screen.dirty = 1;
		}
	}
	gs_labels_update(&screen);
}

/* The label a node is, or -1. */
static int label_of_node(int node) {
	for (int i = 0; i < screen.count; i++) {
		if (screen.labels[i].node == node) return i;
	}
	return -1;
}

void gs_label_set_value(int node, int32_t value) {
	const int i = label_of_node(node);
	if (i < 0 || screen.value[i] == value) return;
	screen.value[i] = value;
	screen.dirty = 1;
}

int32_t gs_label_get_value(int node) {
	const int i = label_of_node(node);
	return i < 0 ? 0 : screen.value[i];
}

void gs_label_set_text(int node, const char *text) {
	const int i = label_of_node(node);
	if (i < 0 || screen.text[i] == text) return;
	screen.text[i] = text;
	screen.dirty = 1;
}
