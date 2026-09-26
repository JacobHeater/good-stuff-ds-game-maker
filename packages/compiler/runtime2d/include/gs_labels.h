/*
 * Text (Label nodes) on one screen, drawn with libnds's console on the screen's first background layer: an 8 x 8 grid of 32 columns by 24 rows, each label's first character in the cell
 * the compiler worked out, in one of the console's eight colors. Identical in runtime/ and runtime2d/ (include it after the header that declares GsLabel).
 *
 * The text a label shows is its text with the label's value in place of each `{}`. Anything that changes (a value, a text, visibility) marks the screen dirty and the next
 * `gs_labels_update` clears the layer and draws every shown label again in order (later labels over earlier ones), so overlapping text never leaves bits of the old.
 * Requirements: requirements/scene-designer/STORY.labels-and-text.md
 */
#ifndef GS_LABELS_H
#define GS_LABELS_H

#include <nds.h>
#include <stdio.h>

#define GS_LABEL_SLOTS 32
#define GS_LABEL_BUFFER 800

typedef struct {
	PrintConsole console;
	const GsLabel *labels;
	int count;
	int32_t value[GS_LABEL_SLOTS];
	const char *text[GS_LABEL_SLOTS];
	uint8_t shown[GS_LABEL_SLOTS];
	uint8_t dirty;
} GsLabelScreen;

/* Sets up the layer on an engine whose background memory is already mapped (bank A for the main engine, bank H for the sub engine) and draws the labels as they start. */
static void gs_labels_start(GsLabelScreen *screen, const GsLabel *labels, int count, int mainEngine) {
	screen->labels = labels;
	screen->count = count > GS_LABEL_SLOTS ? GS_LABEL_SLOTS : count;
	screen->dirty = 0;
	if (screen->count == 0) return;
	for (int i = 0; i < screen->count; i++) {
		screen->value[i] = 0;
		screen->text[i] = labels[i].text;
		screen->shown[i] = labels[i].visible;
	}
	consoleInit(&screen->console, 0, BgType_Text4bpp, BgSize_T_256x256, 8, 0, mainEngine, true);
	if (mainEngine) REG_DISPCNT |= DISPLAY_BG0_ACTIVE;
	else REG_DISPCNT_SUB |= DISPLAY_BG0_ACTIVE;
	screen->dirty = 1;
}

/* One label's text with its value written where the `{}` are, as much of it as fits on the screen from its first cell. */
static int gs_label_render(const GsLabelScreen *screen, int i, char *out) {
	int n = 0;
	const char *t = screen->text[i];
	while (*t && n < GS_LABEL_BUFFER - 16) {
		if (t[0] == '{' && t[1] == '}') {
			n += siprintf(out + n, "%d", (int)screen->value[i]);
			t += 2;
		} else {
			out[n++] = *t++;
		}
	}
	const int room = (24 - screen->labels[i].row) * 32 - screen->labels[i].column;
	if (n > room) n = room;
	out[n] = 0;
	return n;
}

static void gs_labels_draw(GsLabelScreen *screen) {
	char buffer[GS_LABEL_BUFFER];
	consoleSelect(&screen->console);
	consoleClear();
	for (int i = 0; i < screen->count; i++) {
		if (!screen->shown[i]) continue;
		const GsLabel *label = &screen->labels[i];
		gs_label_render(screen, i, buffer);
		iprintf("\x1b[%d;%dH\x1b[3%dm%s", label->row, label->column, label->color, buffer);
	}
	screen->dirty = 0;
}

/* Once a frame: draws again if anything changed. */
static void gs_labels_update(GsLabelScreen *screen) {
	if (screen->count > 0 && screen->dirty) gs_labels_draw(screen);
}

#endif
