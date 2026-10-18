// Prototype E2E for TileMap3D's click-to-paint in the 3D viewport (requirements/scene-designer's own
// STORY.tile-map-3d.md, Phase 4; the plan this story was built from is
// C:\Users\catho\.claude\plans\keen-greeting-glade.md). Drives the built Electron app over CDP with real clicks:
// imports a model, adds a TileMap3D, builds a one-tile palette from the Inspector, switches to the Paint tool,
// clicks the viewport's own ground-plane fallback to paint a cell, clicks the same spot again to place a second
// cell beside the first one's face, then Shift+clicks to erase one -- and checks the saved project file after
// each step, since that's the one place the whole pipeline (click -> raycast -> PAINT_TILE_3D/ERASE_TILE_3D ->
// reducer -> saved scene) actually has to agree.
//
//   pnpm build && node tests/prototypes/e2e/tile-map-3d.mjs
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const HOUSE = join(HERE, "models", "house.obj").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-tile3d-e2e-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/grid.gsds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

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
  globalThis.__save = null; globalThis.__open = null;
  dialog.showSaveDialog = async () => globalThis.__save ? { canceled: false, filePath: globalThis.__save } : { canceled: true };
  dialog.showOpenDialog = async () => globalThis.__open ? { canceled: false, filePaths: [globalThis.__open] } : { canceled: true, filePaths: [] };
  // Import Model asks a separate "keep the file's own normals, or recalculate them?" question (assets-ipc.ts's
  // own askRecalculateNormals) via dialog.showMessageBox, unrelated to the open/save dialogs above -- stubbed to
  // its own default (button 0, "use the file's own normals") so importing a model doesn't hang on a real native
  // modal no automated click can ever answer.
  dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  return "ok";
})()`);
const answerSave = (p) => mainEval(`globalThis.__save = ${JSON.stringify(p)}`);
const answerOpen = (p) => mainEval(`globalThis.__open = ${JSON.stringify(p)}`);

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
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(200);
};
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
const importFile = async (path) => { await answerOpen(path); await menu("Scene"); await click("Import Model (.obj)..."); await sleep(400); };
const tileMap3DOf = (project) => project.scene.children.find((c) => c.kind === "TileMap3D").tileMap3D;

async function viewportCenter() {
  const r = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

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
  await page.type("input[type=text]", "Grid3D");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await tab("3D");

  // ---- A model to paint with, and a TileMap3D to paint on. Importing a model adds both the model data (what the
  // palette will reference) and a visible MeshInstance3D node using it -- only the data is wanted here, so the
  // node is deleted right away: left in place, it would sit at the origin and occlude the TileMap3D's own
  // ground-plane picker exactly where the test clicks, an unrelated node getting in the way rather than anything
  // about TileMap3D itself.
  await importFile(HOUSE);
  await waitText('Imported model "house"');
  await menu("Scene");
  await click("Delete Node");
  await selectRow("Main");
  await addNode("TileMap3D");
  assert.equal(await page.evaluate(() => document.querySelector("[data-testid=tilemap3d-field]") !== null), true, "the Inspector shows the TileMap3D palette field for a selected TileMap3D");
  pass("a model is imported and a TileMap3D is added, with the Inspector showing its palette field");

  // ---- Building the palette from the Inspector.
  await click("Add tile");
  assert.equal(await page.evaluate(() => document.querySelectorAll("[data-testid=tile3d-palette] [data-testid^=tile3d-entry-]").length), 1, "one palette entry was added");
  const pickedByDefault = await page.evaluate(() => document.querySelector("[data-testid=tile3d-palette] button[data-testid^=tile3d-pick-]").textContent.trim());
  assert.equal(pickedByDefault, "✓", "the new entry becomes the active brush right away");
  pass("Add tile adds one palette entry (using the only imported model) and picks it as the brush");

  // ---- Switching to the Paint tool, then painting the ground-plane fallback (nothing painted there yet).
  await click("Paint");
  await sleep(200);
  let center = await viewportCenter();
  await page.mouse.click(center.x, center.y);
  await sleep(300);
  await saveProject();
  const firstPaint = tileMap3DOf(readProject());
  const paintedCells = Object.keys(firstPaint.cells);
  assert.equal(paintedCells.length, 1, "exactly one cell was painted by the one click on the ground plane");
  const [firstCellKey] = paintedCells;
  assert.equal(firstPaint.cells[firstCellKey].paletteId, firstPaint.palette[0].id, "painted with the active brush's palette entry");
  // The TileMap3D itself is still selected after the click -- not deselected to the scene root the way clicking
  // empty space elsewhere in the viewport would be (STORY.tile-map-3d.md's Phase 4): a picker with nothing of its
  // own to select must still stop the click from falling through to Canvas's own onPointerMissed, or a second
  // click right after the first would have nothing left selected to paint on.
  assert.equal(await page.evaluate(() => document.querySelector('input[aria-label="Name"]')?.value), "TileMap3D");
  pass(`clicking the Paint tool's ground-plane fallback paints a cell (at grid cell ${firstCellKey}), and the grid stays selected`);

  // ---- Clicking the same spot again: now it hits the cell's own face (the camera's exact framing decides which
  // face, but whichever it is, a *different*, adjacent cell is painted, not the same one again with no effect --
  // the thing only a real click in a real running app proves, since it depends on the actual raycast hit, not just
  // the reducer's own already-unit-tested math).
  center = await viewportCenter();
  await page.mouse.click(center.x, center.y);
  await sleep(300);
  await saveProject();
  const secondPaint = tileMap3DOf(readProject());
  const cellsAfterSecondClick = Object.keys(secondPaint.cells);
  assert.equal(cellsAfterSecondClick.length, 2, "clicking the now-painted cell's own face places a second, adjacent cell rather than repainting the same one");
  assert.ok(cellsAfterSecondClick.includes(firstCellKey), "the first cell is still there");
  pass("clicking an already-painted cell's face places the brush beside it instead of on top of it");

  // ---- Shift+click erases the cell actually clicked.
  const click3 = await viewportCenter();
  await page.keyboard.down("Shift");
  await page.mouse.click(click3.x, click3.y);
  await page.keyboard.up("Shift");
  await sleep(300);
  await saveProject();
  const afterErase = tileMap3DOf(readProject());
  assert.equal(Object.keys(afterErase.cells).length, 1, "Shift+click erased exactly one cell");
  pass("Shift+click on a painted cell erases it");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "tile-map-3d-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}

async function tab(name) { await click(name); await sleep(300); }
