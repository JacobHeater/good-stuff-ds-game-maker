// Prototype E2E for 2D sprite images (requirements/scene-designer/STORY.import-sprite-image.md). Drives the built Electron
// app over CDP and stubs only the native file dialogs. It writes real PNG files (good and bad), imports them through the real UI
// into a 2D project, reads the pixels the 2D viewport actually draws, puts sprites on both screens, saves, reopens, undoes, exports a
// real ROM and prints where it saved the project so the emulator test can run it (GSDS_SPRITES_ROM_PROJECT).
//
//   pnpm build && node tests/prototypes/e2e/sprite-image.mjs
//
// Needs tools/ds-toolchain for the final export. Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// pngjs comes from the compiler package (this folder has only puppeteer-core): it writes the test images and reads screenshots.
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-sprite-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/sprites.gsds`;
const ROM_PATH = `${work}/sprites.nds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

// ---- Test images.
function writePng(path, width, height, pixel) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set(pixel(x, y), (y * width + x) * 4);
  writeFileSync(path, PNG.sync.write(png));
}
// 32 x 32: four quadrants inside a 4-pixel transparent border.
writePng(`${work}/hero.png`, 32, 32, (x, y) => {
  if (x < 4 || y < 4 || x >= 28 || y >= 28) return [0, 0, 0, 0];
  return y < 16 ? (x < 16 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : x < 16 ? [0, 0, 255, 255] : [255, 255, 0, 255];
});
writePng(`${work}/coin.png`, 16, 16, (x, y) => (Math.abs(x - 7.5) + Math.abs(y - 7.5) < 6 ? [255, 255, 255, 255] : [255, 0, 255, 255]));
writePng(`${work}/odd-size.png`, 24, 24, () => [10, 20, 30, 255]);
writePng(`${work}/too-big.png`, 128, 128, () => [10, 20, 30, 255]);
writePng(`${work}/not-oam.png`, 64, 16, () => [10, 20, 30, 255]); // both sides are fine on their own, but the DS has no 64 x 16 sprite
writePng(`${work}/gradient.png`, 64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2, 255]); // 4096 colors: more than 255
writeFileSync(`${work}/not-a-png.png`, "this is not an image at all");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(`${DESKTOP}/node_modules/electron/dist/electron.exe`, [".", "--remote-debugging-port=9333", "--inspect=9229", `--user-data-dir=${work}/userdata`], { cwd: DESKTOP, env, stdio: "ignore" });

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch {}
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}
async function mainEval(expression) {
  const targets = await (await fetch("http://127.0.0.1:9229/json")).json();
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const out = await new Promise((res) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) res(d); };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true } }));
  });
  ws.close();
  if (out.result?.exceptionDetails) throw new Error(JSON.stringify(out.result.exceptionDetails));
  return out.result?.result?.value;
}
const installDialogs = () => mainEval(`(() => {
  const req = (process.mainModule && process.mainModule.require) || require;
  const { dialog } = req("electron");
  globalThis.__save = null; globalThis.__open = null; globalThis.__openCalls = [];
  dialog.showSaveDialog = async () => globalThis.__save ? { canceled: false, filePath: globalThis.__save } : { canceled: true };
  dialog.showOpenDialog = async (...args) => {
    const options = args[args.length - 1];
    globalThis.__openCalls.push({ title: options.title, filters: options.filters });
    return globalThis.__open ? { canceled: false, filePaths: [globalThis.__open] } : { canceled: true, filePaths: [] };
  };
  return "ok";
})()`);
const answerSave = (p) => mainEval(`globalThis.__save = ${JSON.stringify(p)}`);
const answerOpen = (p) => mainEval(`globalThis.__open = ${JSON.stringify(p)}`);
const openCalls = () => mainEval("globalThis.__openCalls");

let page;
const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => r.querySelector("span.flex-1")?.textContent.trim()).filter(Boolean));
const selectRow = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
  if (!row) throw new Error(`no scene tree row "${name}"`);
  row.click();
}, name);
const isDirty = async () => (await body()).includes("Unsaved changes");
const bottomTab = async (name) => { await click(name); await sleep(150); };
async function setInspectorNumber(label, value) {
  await page.evaluate((label, value) => {
    const wrap = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === label);
    if (!wrap) throw new Error(`no Inspector field "${label}"`);
    const input = wrap.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, label, value);
  await sleep(150);
}
async function chooseInField(label, prefix) {
  await page.evaluate((label, prefix) => {
    const wrap = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === label);
    const select = wrap.querySelector("select");
    const option = [...select.options].find((o) => o.textContent.trim().startsWith(prefix));
    if (!option) throw new Error(`no "${label}" option starting with "${prefix}"`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, label, prefix);
  await sleep(200);
}
const imageField = () => page.evaluate(() => {
  const wrap = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Image");
  const select = wrap?.querySelector("select");
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Import PNG...");
  return {
    select: select ? { selected: select.selectedOptions[0]?.textContent.trim(), options: [...select.options].map((o) => o.textContent.trim()) } : null,
    button: Boolean(button),
    preview: Boolean(document.querySelector("[data-testid=sprite-preview]"))
  };
});
async function importPng(path) {
  await answerOpen(path);
  await click("Import PNG...");
  await sleep(500);
}
async function chord(key, { shift = false } = {}) {
  await page.keyboard.down("Control");
  if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(250);
}
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
const setScreenFilter = (value) => page.evaluate((value) => {
  const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "both"));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, value);

/** The sprite images the 2D viewport shows: node id, on-screen size (2 px per DS pixel), and which screen canvas each is in. */
const drawnSprites = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=sprite-image]")].map((el) => {
  const box = el.getBoundingClientRect();
  return { id: el.dataset.nodeId, width: box.width, height: box.height, left: box.left, top: box.top, screen: el.parentElement.previousElementSibling?.textContent.trim().split(" ")[0] };
}));
/** Reads the colors of the sprite image element from a screenshot of it. */
async function spritePixels(index = 0) {
  const els = await page.$$("[data-testid=sprite-image]");
  const png = PNG.sync.read(Buffer.from(await els[index].screenshot({ encoding: "base64" }), "base64"));
  const at = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
  return { width: png.width, height: png.height, at };
}
const isColor = ([r, g, b], [er, eg, eb], tolerance = 40) => Math.abs(r - er) <= tolerance && Math.abs(g - eg) <= tolerance && Math.abs(b - eb) <= tolerance;

try {
  await waitFor("http://127.0.0.1:9333/json/version");
  await waitFor("http://127.0.0.1:9229/json");
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null });
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes("index.html"));
    if (!page) await sleep(500);
  }
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });
  await installDialogs();
  await waitText("New Project");
  await answerSave(PROJECT_PATH);
  await click("New Project");
  await page.type("input[type=text]", "Sprites");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- A Sprite2D's Inspector has an Image field (None) and an import button; other nodes have neither.
  assert.equal((await imageField()).select, null, "the scene root has no Image field");
  await addNode("Sprite2D");
  let f = await imageField();
  assert.deepEqual(f.select.options, ["None"]);
  assert.equal(f.select.selected, "None");
  assert.ok(f.button && !f.preview);
  assert.ok((await body()).includes("No image: nothing is drawn for this sprite in the ROM."));
  await selectRow("Main");
  await addNode("Label");
  assert.equal((await imageField()).select, null, "a Label has no Image field");
  await selectRow("Sprite2D");
  pass("a Sprite2D's Inspector has an Image field (None) and an Import PNG button; the root and a Label have neither");

  // ---- Cancelling does nothing. (Save first, so "unedited" means something.)
  await saveProject();
  await answerOpen(null);
  await click("Import PNG...");
  await sleep(500);
  assert.equal(await isDirty(), false);
  assert.equal((await imageField()).select.selected, "None");
  const dialog = (await openCalls()).at(-1);
  assert.equal(dialog.title, "Import Sprite Image");
  assert.deepEqual(dialog.filters, [{ name: "PNG image", extensions: ["png"] }]);
  pass("cancelling the import dialog changes nothing (a PNG-only dialog)");

  // ---- Files the DS can't use are refused, with a reason, and change nothing.
  await bottomTab("Output");
  for (const [file, reason] of [
    ["odd-size.png", /24 x 24 pixels.*8 x 8, 16 x 16, 32 x 32, 64 x 64, 16 x 8/],
    ["too-big.png", /128 x 128 pixels/],
    ["not-oam.png", /64 x 16 pixels/],
    ["not-a-png.png", /isn't a PNG image/]
  ]) {
    await importPng(`${work}/${file}`);
    assert.match(await body(), reason, `${file} is refused with its reason`);
    assert.equal(await isDirty(), false, `${file} changed nothing`);
    assert.equal((await imageField()).select.selected, "None");
  }
  assert.equal((await drawnSprites()).length, 0);
  pass("a size the DS has no sprite for, and a file that isn't a PNG, are refused with the reason and change nothing");

  // ---- A good image goes into the project and onto the sprite, and the viewport draws it as the DS would.
  await setInspectorNumber("Position X", 128);
  await setInspectorNumber("Position Y", 96);
  await importPng(`${work}/hero.png`);
  f = await imageField();
  assert.equal(f.select.selected, "hero (32 x 32)");
  assert.deepEqual(f.select.options, ["None", "hero (32 x 32)"]);
  assert.ok(f.preview, "the Inspector previews it");
  assert.match(await body(), /Imported sprite image "hero" \(32 x 32, 1024 bytes of sprite memory\) onto "Sprite2D"\./);
  assert.equal(await isDirty(), true);
  let sprites = await drawnSprites();
  assert.equal(sprites.length, 1);
  assert.equal(Math.round(sprites[0].width), 64, "32 DS pixels at 2 screen pixels each");
  assert.equal(Math.round(sprites[0].height), 64);
  const px = await spritePixels(0);
  const scale = px.width / 32;
  const at = (x, y) => px.at(Math.floor((x + 0.5) * scale), Math.floor((y + 0.5) * scale));
  assert.ok(isColor(at(8, 8), [255, 0, 0]), "top left quadrant is red");
  assert.ok(isColor(at(24, 8), [0, 255, 0]), "top right quadrant is green");
  assert.ok(isColor(at(8, 24), [0, 0, 255]), "bottom left quadrant is blue");
  assert.ok(isColor(at(24, 24), [255, 255, 0]), "bottom right quadrant is yellow");
  assert.ok(!isColor(at(1, 1), [255, 0, 0], 60) && !isColor(at(1, 1), [0, 255, 0], 60) && !isColor(at(1, 1), [0, 0, 255], 60) && !isColor(at(1, 1), [255, 255, 0], 60), "the transparent border shows the screen behind it");
  pass("importing a PNG puts it in the project and on the sprite, and the 2D viewport draws it with the DS's palette and transparency");

  // ---- The Hardware tab counts it per screen.
  await bottomTab("Hardware");
  assert.match(await body(), /TOP SCREEN\s*1 \/ 128\s*Sprite memory\s*1024 \/ 131072 bytes\s*Sprite palettes\s*1 \/ 16/i);
  assert.match(await body(), /BOTTOM SCREEN\s*0 \/ 128\s*Sprite memory\s*0 \/ 131072 bytes/i);
  pass("the Hardware tab shows the sprite, its memory and its palette on the top screen");

  // ---- Undo / redo take the image out of the project and back.
  await chord("z");
  assert.equal((await drawnSprites()).length, 0, "undo removes the picture");
  assert.equal((await imageField()).select.selected, "None");
  await chord("z", { shift: true });
  assert.equal((await drawnSprites()).length, 1, "redo brings it back");
  pass("undo removes the imported image and redo restores it");

  // ---- A second image, a new Sprite2D on the other screen, and choosing images.
  await selectRow("Main");
  await addNode("Sprite2D");
  await chooseInField("Screen", "bottom");
  await setInspectorNumber("Position X", 60);
  await setInspectorNumber("Position Y", 150);
  await importPng(`${work}/coin.png`);
  f = await imageField();
  assert.deepEqual(f.select.options, ["None", "hero (32 x 32)", "coin (16 x 16)"]);
  await setScreenFilter("both");
  await sleep(200);
  sprites = await drawnSprites();
  assert.equal(sprites.length, 2);
  assert.deepEqual(sprites.map((s) => s.screen).sort(), ["bottom", "top"], "one sprite on each screen");
  await chooseInField("Image", "hero");
  assert.equal((await imageField()).select.selected, "hero (32 x 32)");
  await chooseInField("Image", "coin");
  await bottomTab("Hardware");
  assert.match(await body(), /BOTTOM SCREEN\s*1 \/ 128\s*Sprite memory\s*256 \/ 131072 bytes\s*Sprite palettes\s*1 \/ 16/i);
  pass("a node can be put on the bottom screen; each screen draws its own sprites and counts its own images");

  // ---- A picture with more than 255 colors is imported with a warning.
  await selectRow("Sprite2D2");
  await bottomTab("Output");
  await importPng(`${work}/gradient.png`);
  assert.match(await body(), /Warning: The image has \d+ distinct colors; a DS sprite has at most 255/);
  await chord("z"); // and undo it, so the project keeps its two images
  pass("a picture with too many colors is reduced to 255 and says so in the Output log");

  // ---- Save: the file holds both images already converted; reopen: the sprites are back.
  await selectRow("Sprite2D");
  await saveProject();
  const saved = readProject();
  assert.equal(saved.sprites.length, 2);
  const hero = saved.sprites.find((s) => s.name === "hero");
  assert.deepEqual([hero.width, hero.height], [32, 32]);
  assert.equal(Buffer.from(hero.pixels, "base64").length, 32 * 32);
  assert.ok(Buffer.from(hero.palette, "base64").length <= 256 * 2);
  const nodes = [];
  const walk = (n) => { nodes.push(n); n.children.forEach(walk); };
  walk(saved.scene);
  assert.deepEqual(nodes.filter((n) => n.kind === "Sprite2D").map((n) => [n.screen, n.spriteId === hero.id]), [["top", true], ["bottom", false]]);
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await click("Open Existing Project");
  await sleep(300);
  await click("Sprites", { endsWith: false }).catch(async () => {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Sprites")).click());
  });
  await waitText("Scene Tree");
  await sleep(400);
  assert.equal((await drawnSprites()).length, 2, "both sprites are drawn again after reopening");
  pass("saving stores both converted images in the project file, and reopening draws the sprites again");

  // ---- Export a real ROM.
  await bottomTab("Output");
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 90000);
  const rom = readFileSync(ROM_PATH);
  assert.equal(rom.subarray(0, 8).toString(), "HOMEBREW");
  assert.ok(rom.length > 100 * 1024);
  pass("Export ROM builds a valid .nds from the 2D project");
  copyFileSync(PROJECT_PATH, `${work}/sprites-for-rom.gsds`); // the last check deletes the sprites and saves over the project
  console.log(`\nSaved project (for the emulator test): GSDS_SPRITES_ROM_PROJECT=${work}/sprites-for-rom.gsds`);

  // ---- Unused images aren't saved.
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  for (const name of (await rowNames()).filter((n) => n !== "Main" && n !== "Label")) {
    await selectRow(name);
    await menu("Scene");
    await click("Delete Node");
    await sleep(200);
  }
  await saveProject();
  assert.ok(!("sprites" in readProject()), "with no sprite using them, the images aren't in the file");
  pass("images no sprite uses are dropped from the file on save");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "sprite-image-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
