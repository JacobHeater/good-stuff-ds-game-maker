/*
 * The game's save file (requirements/scripting/STORY.game-state-and-save.md): the project's global variables written out and read back. A script asks with save_game(), load_game() and
 * has_save(). The file is a small header (a magic number, a signature of which globals the game has, how many, and a checksum) and then each global as one 32-bit number, so a save from
 * a different version of the game (other globals) or a damaged one is never loaded into the wrong variables.
 *
 * Where it goes: homebrew has no cartridge save chip, so the file is written to the SD card of a flash card (or of the emulator) through libfat, next to the game, as gsds-<signature>.sav.
 * With no card (libfat can't start), it falls back to a cartridge's save memory (EEPROM or flash), for a game put on a real cartridge. With neither, saving does nothing and says so.
 */
#include <nds.h>
#include <fat.h>
#include <stdio.h>
#include <string.h>

#include "gs_api.h"

#define GS_SAVE_MAGIC 0x53445347u /* "GSDS" */
#define GS_SAVE_MAX_GLOBALS 64

typedef struct {
	uint32_t magic;
	uint32_t signature;
	uint32_t count;
	uint32_t checksum;
} SaveHeader;

typedef struct {
	SaveHeader header;
	int32_t values[GS_SAVE_MAX_GLOBALS];
} SaveBlob;

static uint32_t checksum_of(const int32_t *values, int count) {
	uint32_t hash = 2166136261u;
	for (int i = 0; i < count; i++) {
		uint32_t word = (uint32_t)values[i];
		for (int b = 0; b < 4; b++) {
			hash ^= word & 255u;
			hash *= 16777619u;
			word >>= 8;
		}
	}
	return hash;
}

/* ---- Where the bytes go */

static int fat_state; /* 0: not tried yet, 1: an SD card is there, -1: none */

static int fat_ready(void) {
	if (fat_state == 0) fat_state = fatInitDefault() ? 1 : -1;
	return fat_state > 0;
}

static void save_path(char *out) {
	siprintf(out, "gsds-%08x.sav", (unsigned)gs_global_signature);
}

/* The kind of save memory the cartridge has (1 to 3), or 0 for none. */
static int cartridge_type(void) {
	const int type = cardEepromGetType();
	return type > 0 ? type : 0;
}

/* Reads up to `length` bytes of the save; the number read (0 when there is none). */
static int read_bytes(uint8_t *out, int length) {
	if (fat_ready()) {
		char path[32];
		save_path(path);
		FILE *file = fopen(path, "rb");
		if (!file) return 0;
		const int got = (int)fread(out, 1, length, file);
		fclose(file);
		return got;
	}
	const int type = cartridge_type();
	if (!type) return 0;
	cardReadEeprom(0, out, length, type);
	return length;
}

static int write_bytes(const uint8_t *data, int length) {
	if (fat_ready()) {
		char path[32];
		save_path(path);
		FILE *file = fopen(path, "wb");
		if (!file) return 0;
		const int put = (int)fwrite(data, 1, length, file);
		fclose(file);
		return put == length;
	}
	const int type = cartridge_type();
	if (!type) return 0;
	/* Flash memory has to be erased before it is written; the first sector (which is where the save lives) is enough. */
	if (type == 3) cardEepromSectorErase(0);
	cardWriteEeprom(0, (u8 *)data, length, type);
	return 1;
}

/* ---- The file */

static int blob_size(void) {
	return (int)sizeof(SaveHeader) + gs_global_count * 4;
}

/* Reads the save into `blob` if there is one for this game: the magic, signature, count and checksum all match. */
static int read_save(SaveBlob *blob) {
	if (gs_global_count > GS_SAVE_MAX_GLOBALS) return 0;
	memset(blob, 0, sizeof(*blob));
	if (read_bytes((uint8_t *)blob, blob_size()) != blob_size()) return 0;
	const SaveHeader *header = &blob->header;
	if (header->magic != GS_SAVE_MAGIC || header->signature != gs_global_signature || header->count != gs_global_count) return 0;
	return checksum_of(blob->values, gs_global_count) == header->checksum;
}

int gs_has_save(void) {
	SaveBlob blob __attribute__((aligned(4)));
	return read_save(&blob);
}

int gs_load_game(void) {
	SaveBlob blob __attribute__((aligned(4)));
	if (!read_save(&blob)) return 0;
	for (int i = 0; i < gs_global_count; i++) gs_global[i] = blob.values[i];
	return 1;
}

int gs_save_game(void) {
	if (gs_global_count > GS_SAVE_MAX_GLOBALS) return 0;
	SaveBlob blob __attribute__((aligned(4)));
	memset(&blob, 0, sizeof(blob));
	blob.header.magic = GS_SAVE_MAGIC;
	blob.header.signature = gs_global_signature;
	blob.header.count = gs_global_count;
	for (int i = 0; i < gs_global_count; i++) blob.values[i] = gs_global[i];
	blob.header.checksum = checksum_of(blob.values, gs_global_count);
	return write_bytes((const uint8_t *)&blob, blob_size());
}
