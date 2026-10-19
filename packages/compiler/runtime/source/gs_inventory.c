/*
 * Stack-based item storage for an Inventory node. Requirements: requirements/scene-designer/STORY.inventory.md
 *
 * Which items exist is project-wide (GsScene.items, the same for every scene -- see DsInventoryItem's own comment in
 * ds-scene.ts); an Inventory instance only keeps its own slots, each either empty (-1) or one item and a count, up
 * to that item's own max stack. add() fills same-item slots first, then empty ones; slots are anonymous, so which
 * one a given item ends up in is never something a script or the player chooses.
 */
#include <stdlib.h>

#include "gs_api.h"
#include "gs_runtime.h"
#include "scene.h"

typedef struct {
	int16_t *slotItem;  /* -1 = empty, one entry per slot */
	uint8_t *slotCount;
} InventoryState;
static InventoryState *inventoryState;
/* Which slot the player last touched on each Inventory's own on-screen panel (STORY.inventory-ui-panel.md), -1 =
   none; parallel to inventoryState, one entry an inventory with no panel at all never uses. */
static int *selectedSlot;

void gs_inventory_reset(void) {
	if (inventoryState) {
		for (int i = 0; i < gs_scene.inventoryCount; i++) {
			free(inventoryState[i].slotItem);
			free(inventoryState[i].slotCount);
		}
	}
	free(inventoryState);
	inventoryState = 0;
	free(selectedSlot);
	selectedSlot = 0;
}

void gs_init_inventory(void) {
	gs_inventory_reset();
	if (gs_scene.inventoryCount == 0) return;
	inventoryState = malloc(sizeof(InventoryState) * gs_scene.inventoryCount);
	selectedSlot = malloc(sizeof(int) * gs_scene.inventoryCount);
	for (int i = 0; i < gs_scene.inventoryCount; i++) {
		int slots = gs_scene.inventories[i].slots;
		inventoryState[i].slotItem = malloc(sizeof(int16_t) * slots);
		inventoryState[i].slotCount = calloc(slots, sizeof(uint8_t));
		for (int s = 0; s < slots; s++) inventoryState[i].slotItem[s] = -1;
		selectedSlot[i] = -1;
	}
}

int gs_node_inventory(int node) { return gs_scene.nodes[node].inventory; }

int gs_inventory_add(int inv, int item, int count) {
	if (count <= 0) return 0;
	if (inv < 0 || !inventoryState || item < 0 || item >= gs_scene.itemCount) return count;
	InventoryState *state = &inventoryState[inv];
	const int slots = gs_scene.inventories[inv].slots;
	const int maxStack = gs_scene.items[item].maxStack;
	int remaining = count;
	for (int s = 0; s < slots && remaining > 0; s++) {
		if (state->slotItem[s] != item) continue;
		const int room = maxStack - state->slotCount[s];
		const int add = room < remaining ? room : remaining;
		state->slotCount[s] += add;
		remaining -= add;
	}
	for (int s = 0; s < slots && remaining > 0; s++) {
		if (state->slotItem[s] != -1) continue;
		const int add = maxStack < remaining ? maxStack : remaining;
		state->slotItem[s] = (int16_t)item;
		state->slotCount[s] = (uint8_t)add;
		remaining -= add;
	}
	return remaining;
}

int gs_inventory_remove(int inv, int item, int count) {
	if (inv < 0 || !inventoryState || item < 0 || count <= 0) return 0;
	InventoryState *state = &inventoryState[inv];
	const int slots = gs_scene.inventories[inv].slots;
	int removed = 0;
	for (int s = 0; s < slots && removed < count; s++) {
		if (state->slotItem[s] != item) continue;
		const int take = state->slotCount[s] < (count - removed) ? state->slotCount[s] : (count - removed);
		state->slotCount[s] -= take;
		removed += take;
		if (state->slotCount[s] == 0) state->slotItem[s] = -1;
	}
	return removed;
}

int gs_inventory_count(int inv, int item) {
	if (inv < 0 || !inventoryState || item < 0) return 0;
	InventoryState *state = &inventoryState[inv];
	const int slots = gs_scene.inventories[inv].slots;
	int total = 0;
	for (int s = 0; s < slots; s++) {
		if (state->slotItem[s] == item) total += state->slotCount[s];
	}
	return total;
}

int gs_inventory_slot_count(int inv, int slot) {
	if (inv < 0 || !inventoryState || slot < 0 || slot >= gs_scene.inventories[inv].slots) return 0;
	return inventoryState[inv].slotCount[slot];
}

int gs_inventory_slot_item_is(int inv, int slot, int item) {
	if (inv < 0 || !inventoryState || slot < 0 || slot >= gs_scene.inventories[inv].slots) return 0;
	return inventoryState[inv].slotItem[slot] == item;
}

int gs_inventory_slot_icon(int inv, int slot) {
	if (inv < 0 || !inventoryState || slot < 0 || slot >= gs_scene.inventories[inv].slots) return -1;
	const int item = inventoryState[inv].slotItem[slot];
	return item < 0 ? -1 : gs_scene.items[item].iconFrame;
}

int gs_inventory_selected_slot(int inv) {
	if (inv < 0 || !selectedSlot) return -1;
	return selectedSlot[inv];
}

void gs_inventory_select_slot(int inv, int slot) {
	if (inv < 0 || !selectedSlot) return;
	selectedSlot[inv] = (slot < 0 || slot >= gs_scene.inventories[inv].slots) ? -1 : slot;
}

/* ---- The on-screen panel (STORY.inventory-ui-panel.md) ----------------------------------------------------- */

/*
 * Once a frame, after the scripts, at the same point gs_update_sprites/gs_update_labels run from (it calls
 * straight into both, by the raw sprite/label indices GsInventory already gives it -- a panel's own sprites and
 * labels are folded into those same screen-wide tables, not a set of their own; see translate-scene-2d.ts's own
 * comment on why). Nothing here moves the panel itself: it stays at its node's own starting position even if a
 * script moves that node afterward (this story's own accepted v1 limit) -- only its live `visible` is tracked.
 */
void gs_update_inventory_panel(void) {
	for (int i = 0; i < gs_scene.inventoryCount; i++) {
		const GsInventory *inv = &gs_scene.inventories[i];
		const int hasPanel = inv->backgroundSprite >= 0 || inv->slotSpriteStart >= 0 || inv->highlightSprite >= 0;
		if (!hasPanel) continue;
		const int visible = gs_node_state[inv->node].visible != 0;

		if (inv->backgroundSprite >= 0) gs_sprite_set_hidden_at(inv->backgroundSprite, !visible);
		for (int s = 0; s < inv->slots; s++) {
			if (inv->slotSpriteStart >= 0) gs_sprite_set_hidden_at(inv->slotSpriteStart - s, !visible);
			if (inv->iconSpriteStart >= 0) gs_sprite_set_hidden_at(inv->iconSpriteStart - s, !visible || gs_inventory_slot_icon(i, s) < 0);
			if (inv->labelStart >= 0) gs_label_set_shown_at(inv->labelStart + s, visible && gs_inventory_slot_count(i, s) > 1);
		}
		if (inv->highlightSprite >= 0) gs_sprite_set_hidden_at(inv->highlightSprite, !visible || selectedSlot[i] < 0);
		if (!visible) continue;

		/* Touch: a tap inside the panel's own fixed grid selects whichever cell it landed on (STORY.inventory-ui-panel.md's own touch-to-select); outside it, or no touch at
		   all this frame, leaves the selection exactly as it was (a script's own select_slot/the player's last tap persists until either one changes it again). */
		if (gs_touching) {
			const int cellW = inv->slotWidth + inv->spacingX, cellH = inv->slotHeight + inv->spacingY;
			const int dx = gs_touch_x - inv->panelX, dy = gs_touch_y - inv->panelY;
			if (dx >= 0 && dy >= 0) {
				const int col = dx / cellW, row = dy / cellH;
				if (col < inv->columns && dx - col * cellW < inv->slotWidth && dy - row * cellH < inv->slotHeight) {
					const int slot = row * inv->columns + col;
					if (slot < inv->slots) selectedSlot[i] = slot;
				}
			}
		}

		for (int s = 0; s < inv->slots; s++) {
			if (inv->slotSpriteStart >= 0) gs_sprite_set_frame_at(inv->slotSpriteStart - s, gs_inventory_slot_count(i, s) > 0 ? 1 : 0);
			const int frame = inv->iconSpriteStart >= 0 ? gs_inventory_slot_icon(i, s) : -1;
			if (frame >= 0) gs_sprite_set_frame_at(inv->iconSpriteStart - s, frame);
			if (inv->labelStart >= 0) gs_label_set_value_at(inv->labelStart + s, gs_inventory_slot_count(i, s));
		}

		if (inv->highlightSprite >= 0 && selectedSlot[i] >= 0) {
			const int slot = selectedSlot[i];
			const int col = slot % inv->columns, row = slot / inv->columns;
			gs_sprite_set_xy_at(inv->highlightSprite, inv->panelX + col * (inv->slotWidth + inv->spacingX), inv->panelY + row * (inv->slotHeight + inv->spacingY));
		}
	}
}
