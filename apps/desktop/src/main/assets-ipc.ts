import { dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createTextureFromRgba, parseObj, SOUND_FILE_EXTENSIONS, type ImportMeshResult, type ImportTextureResult, type PickSoundResult } from "@goodstuff/core";
import { PNG } from "pngjs";

import { ASSETS_IPC_CHANNELS } from "../shared/project-ipc-channels";

/** A model that fits the DS's triangle limit is a few hundred KB of text; a file far past this isn't a usable model. */
const MAX_OBJ_BYTES = 20 * 1024 * 1024;
/** Likewise for a PNG: the largest texture the DS can hold is 512 x 512, which compresses far below this. */
const MAX_PNG_BYTES = 40 * 1024 * 1024;
/** A sound the DS can hold is at most 2 MB after conversion; even a long MP3 is far below this. Past it, decoding to raw samples would take gigabytes. */
const MAX_SOUND_FILE_BYTES = 60 * 1024 * 1024;

/**
 * "Import Model (.obj)...": ask for a file, read it, parse it. Runs here because this is the process
 * that owns the file system; the renderer only ever receives the parsed result. It changes no project:
 * putting the model into one is the renderer's decision, made once it has seen the result. Failures come
 * back as data, never as a thrown error.
 */
export function registerAssetsIpcHandlers(): void {
  ipcMain.handle(ASSETS_IPC_CHANNELS.importTexture, importTexture);
  ipcMain.handle(ASSETS_IPC_CHANNELS.pickSound, pickSound);

  ipcMain.handle(ASSETS_IPC_CHANNELS.importMesh, async (): Promise<ImportMeshResult> => {
    const choice = await dialog.showOpenDialog({
      title: "Import Model",
      properties: ["openFile"],
      filters: [{ name: "Wavefront OBJ model", extensions: ["obj"] }]
    });
    if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
    const filePath = choice.filePaths[0];
    const fileName = basename(filePath);

    try {
      const size = (await stat(filePath)).size;
      if (size > MAX_OBJ_BYTES) {
        return { outcome: "error", fileName, warnings: [], errors: [`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a model the DS can draw is far smaller than that.`] };
      }
      const text = await readFile(filePath, "utf-8");
      const parsed = parseObj(text, { name: basename(filePath, extname(filePath)) });
      if (!parsed.ok) return { outcome: "error", fileName, warnings: [], errors: parsed.errors };
      return { outcome: "ok", fileName, mesh: { id: randomUUID(), ...parsed.mesh }, warnings: parsed.warnings, errors: [] };
    } catch (error) {
      return { outcome: "error", fileName, warnings: [], errors: [`Couldn't read "${fileName}": ${error instanceof Error ? error.message : String(error)}`] };
    }
  });
}

/**
 * "Import Sound...": ask for a file and hand back its bytes. The main process can't decode MP3 or OGG, but the editor window's
 * audio decoder can (it reads all three formats), so decoding and the DS conversion (core's `createSoundFromPcm`) happen there.
 * Failures come back as data.
 */
async function pickSound(): Promise<PickSoundResult> {
  const choice = await dialog.showOpenDialog({
    title: "Import Sound",
    properties: ["openFile"],
    filters: [{ name: "Sound", extensions: [...SOUND_FILE_EXTENSIONS] }]
  });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_SOUND_FILE_BYTES) {
      return { outcome: "error", fileName, errors: [`"${fileName}" is ${(size / 1024 / 1024).toFixed(0)} MB; that is too large to decode and convert. Use a shorter sound.`] };
    }
    return { outcome: "ok", fileName, errors: [], bytes: new Uint8Array(await readFile(filePath)) };
  } catch (error) {
    return { outcome: "error", fileName, errors: [`Couldn't read "${fileName}": ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/**
 * "Import PNG...": ask for a file, decode it, and convert it to a DS texture. pngjs decodes every PNG variant
 * (palettes, 16-bit, interlaced) to plain 8-bit RGBA without applying any color management, so the same file
 * always gives the same texels. The conversion itself, and every size and memory rule, is in core's
 * `createTextureFromRgba`. Failures come back as data.
 */
async function importTexture(): Promise<ImportTextureResult> {
  const choice = await dialog.showOpenDialog({
    title: "Import Texture",
    properties: ["openFile"],
    filters: [{ name: "PNG image", extensions: ["png"] }]
  });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ImportTextureResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_PNG_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a texture the DS can hold is far smaller than that.`);
    const bytes = await readFile(filePath);
    let image: PNG;
    try {
      image = PNG.sync.read(bytes);
    } catch (error) {
      return fail(`"${fileName}" isn't a PNG image the app can read (${error instanceof Error ? error.message : String(error)}).`);
    }
    const converted = createTextureFromRgba(image.data, image.width, image.height, { name: basename(filePath, extname(filePath)) });
    if (!converted.ok) return fail(...converted.errors);
    return { outcome: "ok", fileName, texture: { id: randomUUID(), ...converted.texture }, warnings: converted.warnings, errors: [] };
  } catch (error) {
    return fail(`Couldn't read "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
