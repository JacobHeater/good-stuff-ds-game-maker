import { dialog, ipcMain } from "electron";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import {
  decodeNsbca,
  decodeNsbmd,
  decodeNsbtx,
  decodeStrm,
  encodeNsbtx,
  meshToNsbmd,
  parseObj,
  writeGlb,
  writeObj,
  writeWav,
  type ConvertFileResult,
  type SaveBinaryFileResult
} from "@goodstuff/core";
import { PNG } from "pngjs";

import { CONVERTER_IPC_CHANNELS } from "../shared/project-ipc-channels";

/** Same ceilings `assets-ipc.ts` already uses for a PNG/OBJ import -- a file past this isn't something the DS could ever draw anyway. */
const MAX_PNG_BYTES = 40 * 1024 * 1024;
const MAX_OBJ_BYTES = 20 * 1024 * 1024;
/** A real NSBTX/NSBMD/NSBCA/STRM is small (DS hardware itself can't hold much more); past this it isn't one of this app's own concern. */
const MAX_NITRO_FILE_BYTES = 20 * 1024 * 1024;

/**
 * "Convert PNG to NSBTX...", "Convert OBJ to NSBMD...", and saving the Converter's own WAV -> STRM output (that
 * one's decoding runs in the renderer, since only the editor window can decode WAV/MP3/OGG -- see the Converter
 * tab, `ConverterPanel.tsx`). Runs in the main process for the same reason every other asset import does: this is
 * the process that owns the file system. No project is read or written here at all.
 *
 * See requirements/compiler/STORY.nitro-native-format-converter.md.
 */
export function registerConverterIpcHandlers(): void {
  ipcMain.handle(CONVERTER_IPC_CHANNELS.pngToNsbtx, pngToNsbtx);
  ipcMain.handle(CONVERTER_IPC_CHANNELS.objToNsbmd, objToNsbmd);
  ipcMain.handle(CONVERTER_IPC_CHANNELS.saveBinaryFile, (_event, suggestedName: string, filterName: string, extensions: string[], bytes: Uint8Array) =>
    saveBinaryFile(suggestedName, filterName, extensions, bytes)
  );
  ipcMain.handle(CONVERTER_IPC_CHANNELS.nsbtxToPng, nsbtxToPng);
  ipcMain.handle(CONVERTER_IPC_CHANNELS.nsbmdToObj, nsbmdToObj);
  ipcMain.handle(CONVERTER_IPC_CHANNELS.nsbmdToGlb, nsbmdToGlb);
  ipcMain.handle(CONVERTER_IPC_CHANNELS.strmToWav, strmToWav);
}

async function pngToNsbtx(): Promise<ConvertFileResult> {
  const choice = await dialog.showOpenDialog({ title: "Convert PNG to NSBTX", properties: ["openFile"], filters: [{ name: "PNG image", extensions: ["png"] }] });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ConvertFileResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_PNG_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a DS texture is far smaller than that.`);
    let image: PNG;
    try {
      image = PNG.sync.read(await readFile(filePath));
    } catch (error) {
      return fail(`"${fileName}" isn't a PNG image the app can read (${error instanceof Error ? error.message : String(error)}).`);
    }
    const name = basename(filePath, extname(filePath));
    const result = encodeNsbtx({ name, width: image.width, height: image.height, rgba: image.data });
    if (!result.ok) return fail(...result.errors);

    const save = await dialog.showSaveDialog({ title: "Save NSBTX", defaultPath: `${name}.nsbtx`, filters: [{ name: "NSBTX texture", extensions: ["nsbtx"] }] });
    if (save.canceled || !save.filePath) return { outcome: "canceled", warnings: [], errors: [] };
    await writeFile(save.filePath, result.bytes);
    return { outcome: "ok", fileName, savedTo: save.filePath, warnings: result.warnings, errors: [] };
  } catch (error) {
    return fail(`Couldn't convert "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function objToNsbmd(): Promise<ConvertFileResult> {
  const choice = await dialog.showOpenDialog({ title: "Convert OBJ to NSBMD", properties: ["openFile"], filters: [{ name: "Wavefront OBJ model", extensions: ["obj"] }] });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ConvertFileResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_OBJ_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a model the DS can draw is far smaller than that.`);
    const name = basename(filePath, extname(filePath));
    const parsed = parseObj(await readFile(filePath, "utf-8"), { name });
    if (!parsed.ok) return fail(...parsed.errors);
    const result = meshToNsbmd(parsed.mesh);

    const save = await dialog.showSaveDialog({ title: "Save NSBMD", defaultPath: `${name}.nsbmd`, filters: [{ name: "NSBMD model", extensions: ["nsbmd"] }] });
    if (save.canceled || !save.filePath) return { outcome: "canceled", warnings: [], errors: [] };
    await writeFile(save.filePath, result.bytes);
    return { outcome: "ok", fileName, savedTo: save.filePath, warnings: [...parsed.warnings, ...result.warnings], errors: [] };
  } catch (error) {
    return fail(`Couldn't convert "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function nsbtxToPng(): Promise<ConvertFileResult> {
  const choice = await dialog.showOpenDialog({ title: "Convert NSBTX to PNG", properties: ["openFile"], filters: [{ name: "NSBTX texture", extensions: ["nsbtx"] }] });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ConvertFileResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_NITRO_FILE_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a DS texture file is far smaller than that.`);
    const result = decodeNsbtx(await readFile(filePath));
    if (!result.ok) return fail(...result.errors);

    const name = basename(filePath, extname(filePath));
    const save = await dialog.showSaveDialog({ title: "Save PNG", defaultPath: `${result.textures[0].name || name}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
    if (save.canceled || !save.filePath) return { outcome: "canceled", warnings: [], errors: [] };

    const warnings = [...result.warnings];
    for (const texture of result.textures) {
      const png = new PNG({ width: texture.width, height: texture.height });
      png.data = Buffer.from(texture.rgba.buffer, texture.rgba.byteOffset, texture.rgba.byteLength);
      const path = texture === result.textures[0] ? save.filePath : join(dirname(save.filePath), `${texture.name || "texture"}.png`);
      await writeFile(path, PNG.sync.write(png));
      if (texture !== result.textures[0]) warnings.push(`This NSBTX has more than one texture; "${texture.name}" was also saved, alongside "${basename(save.filePath)}".`);
    }
    return { outcome: "ok", fileName, savedTo: save.filePath, warnings, errors: [] };
  } catch (error) {
    return fail(`Couldn't convert "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function nsbmdToObj(): Promise<ConvertFileResult> {
  const choice = await dialog.showOpenDialog({ title: "Convert NSBMD to OBJ", properties: ["openFile"], filters: [{ name: "NSBMD model", extensions: ["nsbmd"] }] });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ConvertFileResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_NITRO_FILE_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a DS model file is far smaller than that.`);
    const result = decodeNsbmd(await readFile(filePath));
    if (!result.ok) return fail(...result.errors);

    const name = basename(filePath, extname(filePath));
    const obj = writeObj(result.model, name);
    const save = await dialog.showSaveDialog({ title: "Save OBJ", defaultPath: `${name}.obj`, filters: [{ name: "Wavefront OBJ model", extensions: ["obj"] }] });
    if (save.canceled || !save.filePath) return { outcome: "canceled", warnings: [], errors: [] };
    await writeFile(save.filePath, obj, "utf-8");
    return { outcome: "ok", fileName, savedTo: save.filePath, warnings: result.warnings, errors: [] };
  } catch (error) {
    return fail(`Couldn't convert "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Asked once per NSBMD -> GLB conversion: whether to also fold in an NSBCA animation, since a .glb can carry one but an .nsbmd alone has no animation data of its own. */
async function askIncludeAnimation(): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Model only", "Also include an animation (.nsbca)..."],
    defaultId: 0,
    cancelId: 0,
    title: "Include animation?",
    message: "Also include an animation in this GLB?",
    detail: "A .glb can carry an animation, but a DS model's animation lives in a separate .nsbca file. Pick one to include it, or skip for a static model."
  });
  return result.response === 1;
}

async function nsbmdToGlb(): Promise<ConvertFileResult> {
  const choice = await dialog.showOpenDialog({ title: "Convert NSBMD to GLB", properties: ["openFile"], filters: [{ name: "NSBMD model", extensions: ["nsbmd"] }] });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ConvertFileResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_NITRO_FILE_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a DS model file is far smaller than that.`);
    const result = decodeNsbmd(await readFile(filePath));
    if (!result.ok) return fail(...result.errors);
    const warnings = [...result.warnings];

    let animation;
    if (await askIncludeAnimation()) {
      const animChoice = await dialog.showOpenDialog({ title: "Pick an animation (.nsbca)", properties: ["openFile"], filters: [{ name: "NSBCA animation", extensions: ["nsbca"] }] });
      if (!animChoice.canceled && animChoice.filePaths.length > 0) {
        const animResult = decodeNsbca(await readFile(animChoice.filePaths[0]));
        if (!animResult.ok) return fail(...animResult.errors);
        animation = animResult.animation;
        warnings.push(...animResult.warnings);
      }
    }

    const name = basename(filePath, extname(filePath));
    const bytes = writeGlb(result.model, name, animation);
    const save = await dialog.showSaveDialog({ title: "Save GLB", defaultPath: `${name}.glb`, filters: [{ name: "glTF binary model", extensions: ["glb"] }] });
    if (save.canceled || !save.filePath) return { outcome: "canceled", warnings: [], errors: [] };
    await writeFile(save.filePath, bytes);
    return { outcome: "ok", fileName, savedTo: save.filePath, warnings, errors: [] };
  } catch (error) {
    return fail(`Couldn't convert "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function strmToWav(): Promise<ConvertFileResult> {
  const choice = await dialog.showOpenDialog({ title: "Convert STRM to WAV", properties: ["openFile"], filters: [{ name: "STRM sound", extensions: ["strm"] }] });
  if (choice.canceled || choice.filePaths.length === 0) return { outcome: "canceled", warnings: [], errors: [] };
  const filePath = choice.filePaths[0];
  const fileName = basename(filePath);
  const fail = (...errors: string[]): ConvertFileResult => ({ outcome: "error", fileName, warnings: [], errors });

  try {
    const size = (await stat(filePath)).size;
    if (size > MAX_NITRO_FILE_BYTES) return fail(`"${fileName}" is ${(size / 1024 / 1024).toFixed(1)} MB; a DS sound file is far smaller than that.`);
    const result = decodeStrm(await readFile(filePath));
    if (!result.ok) return fail(...result.errors);

    const name = basename(filePath, extname(filePath));
    const bytes = writeWav(result.strm.sampleRate, result.strm.channels);
    const save = await dialog.showSaveDialog({ title: "Save WAV", defaultPath: `${name}.wav`, filters: [{ name: "WAV sound", extensions: ["wav"] }] });
    if (save.canceled || !save.filePath) return { outcome: "canceled", warnings: [], errors: [] };
    await writeFile(save.filePath, bytes);
    return { outcome: "ok", fileName, savedTo: save.filePath, warnings: [], errors: [] };
  } catch (error) {
    return fail(`Couldn't convert "${fileName}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveBinaryFile(suggestedName: string, filterName: string, extensions: string[], bytes: Uint8Array): Promise<SaveBinaryFileResult> {
  const save = await dialog.showSaveDialog({ title: "Save", defaultPath: suggestedName, filters: [{ name: filterName, extensions }] });
  if (save.canceled || !save.filePath) return { outcome: "canceled", errors: [] };
  try {
    await writeFile(save.filePath, bytes);
    return { outcome: "ok", filePath: save.filePath, errors: [] };
  } catch (error) {
    return { outcome: "error", errors: [`Couldn't save "${save.filePath}": ${error instanceof Error ? error.message : String(error)}`] };
  }
}
