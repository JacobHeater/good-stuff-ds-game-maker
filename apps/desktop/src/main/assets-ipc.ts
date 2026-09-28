import { dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { createSpriteFromRgba, createTextureFromRgba, externalGltfFiles, mergeMeshFrames, parseObj, SOUND_FILE_EXTENSIONS, type ImportMeshResult, type ImportSpriteResult, type PickRiggedModelResult, type ImportTextureResult, type PickSoundResult } from "@goodstuff/core";
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
  ipcMain.handle(ASSETS_IPC_CHANNELS.importSprite, (_event, frame?: { width: number; height: number }) => importSprite(frame));
  ipcMain.handle(ASSETS_IPC_CHANNELS.pickSound, pickSound);
  ipcMain.handle(ASSETS_IPC_CHANNELS.pickRiggedModel, pickRiggedModel);

  ipcMain.handle(ASSETS_IPC_CHANNELS.importMesh, async (_event, poses?: boolean): Promise<ImportMeshResult> => {
    const choice = await dialog.showOpenDialog({
      title: poses ? "Import Animated Model (one .obj file for each pose)" : "Import Model",
      properties: poses ? ["openFile", "multiSelections"] : ["openFile"],
      filters: [{ name: "Wavefront OBJ model", extensions: ["obj"] }]
    });
    if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
    const recalculateNormals = await askRecalculateNormals();
    if (choice.filePaths.length > 1) return importPoses(choice.filePaths, recalculateNormals);
    const filePath = choice.filePaths[0];
    const fileName = basename(filePath);

    try {
      const size = (await stat(filePath)).size;
      if (size > MAX_OBJ_BYTES) {
        return { outcome: "error", fileName, warnings: [], errors: [`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a model the DS can draw is far smaller than that.`] };
      }
      const text = await readFile(filePath, "utf-8");
      const parsed = parseObj(text, { name: basename(filePath, extname(filePath)), recalculateNormals });
      if (!parsed.ok) return { outcome: "error", fileName, warnings: [], errors: parsed.errors };
      return { outcome: "ok", fileName, mesh: { id: randomUUID(), ...parsed.mesh }, warnings: parsed.warnings, errors: [] };
    } catch (error) {
      return { outcome: "error", fileName, warnings: [], errors: [`Couldn't read "${fileName}": ${error instanceof Error ? error.message : String(error)}`] };
    }
  });
}

/**
 * Asked once per import (before the file is even read): whether to keep the .obj's own normals (the default, and what
 * every import did before this question existed) or recompute them from the model's actual shape. Recalculating fixes a
 * model whose normals disagree with its real geometry — usually seen as part of it reading unlit/dark from some camera
 * angles but not others — at the cost of flat, per-face shading instead of whatever smooth shading the file's own normals
 * gave it.
 */
async function askRecalculateNormals(): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Use the file's own normals", "Recalculate from the model's shape"],
    defaultId: 0,
    cancelId: 0,
    title: "Model normals",
    message: "Use the file's own normals, or recalculate them from the model's shape?",
    detail:
      "Recalculating fixes a model that looks unlit or dark from some camera angles but not others (its own normals disagree with its actual shape), at the cost of flat, per-face shading instead of smooth shading."
  });
  return result.response === 1;
}

/** A rigged model can be big (a glb with textures); past this it isn't a model the DS can draw. */
const MAX_GLTF_BYTES = 60 * 1024 * 1024;

/**
 * "Import Rigged Model (.glb / .gltf)...": ask for a file and hand back its bytes, plus the files a .gltf refers to (its .bin buffers). The renderer parses it (core's `importGltf`), because the
 * nodes it makes take their ids from the editor's own counter. Failures come back as data.
 */
async function pickRiggedModel(): Promise<PickRiggedModelResult> {
  const choice = await dialog.showOpenDialog({
    title: "Import Rigged Model",
    properties: ["openFile"],
    filters: [{ name: "glTF model", extensions: ["glb", "gltf"] }]
  });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_GLTF_BYTES) return { outcome: "error", fileName, errors: [`"${fileName}" is ${(size / 1024 / 1024).toFixed(0)} MB; a model the DS can draw is far smaller than that.`] };
    const bytes = new Uint8Array(await readFile(filePath));
    const files: Record<string, Uint8Array> = {};
    for (const uri of externalGltfFiles(bytes)) {
      const target = resolve(dirname(filePath), uri);
      if (!target.startsWith(dirname(filePath))) return { outcome: "error", fileName, errors: [`"${fileName}" refers to a file outside its own folder ("${uri}"), which isn't read.`] };
      files[uri] = new Uint8Array(await readFile(target));
    }
    return { outcome: "ok", fileName, errors: [], bytes, files };
  } catch (error) {
    return { outcome: "error", fileName, errors: [`Couldn't read "${fileName}": ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/** File names in the order a person means: walk2 before walk10. */
const byName = (a: string, b: string): number => basename(a).localeCompare(basename(b), undefined, { numeric: true, sensitivity: "base" });

/**
 * Several .obj files as the poses of one animated model (requirements/scene-designer/STORY.animated-3d-models.md): each is parsed like a single import, and they are put together
 * in the order of their names. The model is named for what the files have in common (walk1.obj, walk2.obj: "walk").
 */
async function importPoses(filePaths: string[], recalculateNormals: boolean): Promise<ImportMeshResult> {
  const ordered = [...filePaths].sort(byName);
  const warnings: string[] = [];
  const meshes = [];
  for (const filePath of ordered) {
    const fileName = basename(filePath);
    try {
      const size = (await stat(filePath)).size;
      if (size > MAX_OBJ_BYTES) return { outcome: "error", fileName, warnings: [], errors: [`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a model the DS can draw is far smaller than that.`] };
      const parsed = parseObj(await readFile(filePath, "utf-8"), { name: basename(filePath, extname(filePath)), recalculateNormals });
      if (!parsed.ok) return { outcome: "error", fileName, warnings: [], errors: parsed.errors.map((error) => `${fileName}: ${error}`) };
      warnings.push(...parsed.warnings.map((warning) => `${fileName}: ${warning}`));
      meshes.push({ id: randomUUID(), ...parsed.mesh });
    } catch (error) {
      return { outcome: "error", fileName, warnings: [], errors: [`Couldn't read "${fileName}": ${error instanceof Error ? error.message : String(error)}`] };
    }
  }
  const merged = mergeMeshFrames(meshes);
  if (!merged.ok) return { outcome: "error", warnings: [], errors: merged.errors };
  const shared = meshes[0].name.replace(/[\s_-]*\d+$/, "");
  return { outcome: "ok", fileName: `${ordered.length} files`, mesh: { ...merged.mesh, name: shared === "" ? meshes[0].name : shared }, warnings, errors: [] };
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

/**
 * "Import PNG..." for a Sprite2D: ask for a file, decode it, and convert it to a DS sprite image (256 colors, index 0 transparent).
 * Like the texture import, pngjs gives plain 8-bit RGBA and the conversion and every rule (the sprite sizes, the color reduction) are in
 * core's `createSpriteFromRgba`. Failures come back as data.
 */
async function importSprite(frame?: { width: number; height: number }): Promise<ImportSpriteResult> {
  const choice = await dialog.showOpenDialog({
    title: frame ? "Import Sprite Sheet" : "Import Sprite Image",
    properties: ["openFile"],
    filters: [{ name: "PNG image", extensions: ["png"] }]
  });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ImportSpriteResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_PNG_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a sprite the DS can draw is far smaller than that.`);
    const bytes = await readFile(filePath);
    let image: PNG;
    try {
      image = PNG.sync.read(bytes);
    } catch (error) {
      return fail(`"${fileName}" isn't a PNG image the app can read (${error instanceof Error ? error.message : String(error)}).`);
    }
    const converted = createSpriteFromRgba(image.data, image.width, image.height, { name: basename(filePath, extname(filePath)), ...(frame ? { frame } : {}) });
    if (!converted.ok) return fail(...converted.errors);
    return { outcome: "ok", fileName, sprite: { id: randomUUID(), ...converted.sprite }, warnings: converted.warnings, errors: [] };
  } catch (error) {
    return fail(`Couldn't read "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}
