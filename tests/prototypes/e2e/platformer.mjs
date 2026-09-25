// Prototype E2E for solid shapes as ground (requirements/collision/STORY.solid-shapes-and-move-and-collide.md). Drives the built Electron app over CDP with
// real typing and clicks and stubs only the native file dialogs: the Solid checkbox and its color in the viewport, then a small platformer authored entirely
// through the UI (a player, a solid floor and wall, each with a mesh you can see), with the example player script pasted into the Script tab and attached.
//
//   pnpm build && node tests/prototypes/e2e/platformer.mjs
//
// Needs tools/ds-toolchain for the export. Uses ports 9333 and 9229; close other instances first.
// It prints `SAVED <path>`; GSDS_PLATFORMER_ROM_PROJECT=<path> pnpm test:rom then runs that project in melonDS: the player falls onto the floor and stands
// there, and with the D-pad held it walks into the wall and stops.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-platformer-e2e-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/platformer.gsds`;
const ROM_PATH = `${work}/platformer.nds`;
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
  return "ok";
})()`);
const answerSave = (p) => mainEval(`globalThis.__save = ${JSON.stringify(p)}`);
const answerOpen = (p) => mainEval(`globalThis.__open = ${JSON.stringify(p)}`);

let page;
const click = (label, { endsWith = false, within = "" } = {}) => page.evaluate((label, endsWith, within) => {
  const scope = within ? document.querySelector(within) : document;
  const b = [...scope.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"${within ? ` in ${within}` : ""}`);
  b.click();
}, label, endsWith, within);
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
const isDirty = async () => (await body()).includes("Unsaved changes");
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());
async function chord(key, { shift = false } = {}) {
  await page.keyboard.down("Control");
  if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(300);
}
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
const tab = async (name) => { await click(name); await sleep(300); };

/** Sets the X/Y/Z inputs of an Inspector vector field ("Position", "Rotation (deg)" or "Scale"). */
async function setVector(label, values) {
  await page.evaluate((label, values) => {
    const heading = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === label && d.className.includes("text-[11px]"));
    if (!heading) throw new Error(`no Inspector field "${label}"`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    [...heading.nextElementSibling.querySelectorAll("input")].forEach((input, i) => {
      setter.call(input, String(values[i]));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }, label, values);
  await sleep(120);
}

// ---- Inspector helpers.
const SHAPE = "[data-testid=collision-shape]";
const shapeState = () => page.evaluate((root) => {
  const box = document.querySelector(root);
  if (!box) return null;
  const value = (label) => { const el = box.querySelector(`input[aria-label="${label}"]`); return el ? Number(el.value) : null; };
  return { shape: box.querySelector("select").value, sizeX: value("Size X"), sizeY: value("Size Y"), sizeZ: value("Size Z"), radius: value("Radius"), height: value("Height") };
}, SHAPE);
const chooseShape = async (kind) => {
  await page.evaluate((root, kind) => {
    const select = document.querySelector(`${root} select`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, kind);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, SHAPE, kind);
  await sleep(250);
};
/** Types a number into a shape field the way a person does: select what is there, then type. */
const typeShapeNumber = async (label, text) => {
  const selector = `${SHAPE} input[aria-label="${label}"]`;
  await page.focus(selector);
  await page.evaluate((sel) => document.querySelector(sel).select(), selector);
  await page.keyboard.type(text);
  await sleep(200);
};
const nameField = () => page.evaluate(() => document.querySelector('input[aria-label="Name"]')?.value ?? null);
const renameSelected = async (name) => {
  await page.focus('input[aria-label="Name"]');
  await page.evaluate(() => document.querySelector('input[aria-label="Name"]').select());
  await page.keyboard.type(name);
  await sleep(250);
  await blurFocus();
};

// ---- The viewport, read from screenshots.
async function viewportPixels() {
  const clip = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  return { png: PNG.sync.read(await page.screenshot({ clip })), clip };
}
/** How many pixels of the viewport satisfy `test(r, g, b)`. */
async function countPixels(test) {
  const { png } = await viewportPixels();
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) if (test(png.data[i], png.data[i + 1], png.data[i + 2])) n++;
  return n;
}
// The shape's wireframe renders lighter than its hex color: about (128, 208, 200) teal, and a light blue when selected. The blue grid axes are blue too,
// so "selected" is judged by how much MORE blue there is than with the shape unselected.
const isTeal = (r, g, b) => g > r + 50 && b > r + 45 && Math.abs(g - b) < 25;
const isBlue = (r, g, b) => b > g + 30 && b > 190 && r < 170;

// ---- The Script tab.
const editorText = () => page.evaluate(() => [...document.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"));
async function pasteSource(text) {
  await page.evaluate(() => document.querySelector(".cm-content").focus());
  await chord("a");
  await page.evaluate((text) => {
    const el = document.querySelector(".cm-content");
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await sleep(700);
}
const problems = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=script-problems] button")].map((b) => ({ severity: b.dataset.severity, where: b.children[1].textContent.trim(), message: b.children[2].textContent.trim() })));
const chooseInspectorScript = async (label) => {
  await page.evaluate((label) => {
    const select = document.querySelector("[data-testid=script-field] select");
    const option = [...select.options].find((o) => o.textContent.trim() === label);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, label);
  await sleep(250);
};

const SCRIPT = readFileSync(join(HERE, "../scripts/player-jump.gsscript"), "utf8");
const isOrange = (r, g, b) => r > 190 && g > 110 && g < 210 && b < 150 && r > b + 80;
const SOLID = `${SHAPE} input[aria-label="Solid"]`;
const solidChecked = () => page.evaluate((sel) => document.querySelector(sel).checked, SOLID);
const clickSolid = async () => { await page.evaluate((sel) => document.querySelector(sel).click(), SOLID); await sleep(250); };

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
  await page.type("input[type=text]", "Platformer");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await tab("3D");

  // ---- The Solid checkbox.
  await addNode("CollisionShape3D");
  assert.equal(await solidChecked(), false, "a new shape is not solid");
  assert.match(await body(), /Solid \(a body moved with move_and_collide\(\) is stopped by it: ground, walls, ceilings\)/);
  await selectRow("Main");
  await sleep(400);
  const plainOrange = await countPixels(isOrange);
  const plainTeal = await countPixels(isTeal);
  assert.ok(plainTeal > 1500, `the plain shape is drawn in the shape color (${plainTeal} pixels)`);
  await selectRow("CollisionShape3D");
  await clickSolid();
  assert.equal(await solidChecked(), true);
  await selectRow("Main");
  await sleep(500);
  await page.screenshot({ path: join(HERE, "platformer-viewport.png") });
  const solidOrange = await countPixels(isOrange);
  assert.ok(solidOrange - plainOrange > 800, `a solid shape is drawn in a warm color (${solidOrange} pixels against ${plainOrange})`);
  assert.ok((await countPixels(isTeal)) < plainTeal / 3, "and no longer in the plain shape color");
  await selectRow("CollisionShape3D");
  await chord("z");
  assert.equal(await solidChecked(), false, "one Ctrl+Z turns Solid off again");
  await chord("z", { shift: true });
  assert.equal(await solidChecked(), true, "and Ctrl+Shift+Z back on");
  pass("a new shape is not solid; the Solid checkbox turns it on (undoable), and a solid shape is drawn in a warm color instead of the plain one");

  // ---- Build a small platformer through the UI.
  await selectRow("CollisionShape3D");
  await menu("Scene");
  await click("Delete Node");
  await sleep(250);
  const cube = async (name, position, scale) => {
    await selectRow("Main");
    await addNode("MeshInstance3D");
    await renameSelected(name);
    await setVector("Position", position);
    if (scale) await setVector("Scale", scale);
  };
  const solidBox = async (name, position, size) => {
    await selectRow("Main");
    await addNode("CollisionShape3D");
    await renameSelected(name);
    await setVector("Position", position);
    await chooseShape("box");
    await typeShapeNumber("Size X", String(size[0]));
    await typeShapeNumber("Size Y", String(size[1]));
    await typeShapeNumber("Size Z", String(size[2]));
    await blurFocus();
    await clickSolid();
  };
  await cube("Player", [0, 2, 0]);
  await addNode("CollisionShape3D"); // under the player: its body
  await renameSelected("PlayerShape");
  await cube("FloorMesh", [0.5, -0.5, 0], [7, 1, 3]);
  await solidBox("FloorShape", [0.5, -0.5, 0], [7, 1, 3]);
  await cube("WallMesh", [3, 1.5, 0], [1, 3, 3]);
  await solidBox("WallShape", [3, 1.5, 0], [1, 3, 3]);
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0.5, 1.5, 14]);
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  assert.deepEqual((await rowNames()).sort(), ["Camera3D", "DirectionalLight3D", "FloorMesh", "FloorShape", "Main", "Player", "PlayerShape", "WallMesh", "WallShape"].sort());
  pass("a platformer level is built through the UI: a player with a body shape, a solid floor and wall (each with a visible mesh), a camera and a light");

  // ---- The example player script, in the Script tab.
  await tab("Script");
  await click("New Script", { within: "[data-testid=script-workspace]" });
  await sleep(500);
  await pasteSource(SCRIPT);
  assert.deepEqual((await problems()).filter((p) => p.severity === "error"), [], "the example script has no errors in this scene");
  await tab("3D");
  await selectRow("Player");
  await chooseInspectorScript("Script");
  await tab("Script");
  assert.deepEqual(await problems(), [], "and no problems at all once it is attached to the player (which has a shape under it)");
  // Attached to a node with no shape under it, the same script is an error that says so.
  await tab("3D");
  await selectRow("FloorMesh");
  await chooseInspectorScript("Script");
  await tab("Script");
  const misplaced = await problems();
  assert.ok(misplaced.some((p) => /needs a node with a collision shape under it, and this script is attached to FloorMesh, which has none/.test(p.message)), JSON.stringify(misplaced));
  await tab("3D");
  await selectRow("FloorMesh");
  await chooseInspectorScript("None");
  await tab("Script");
  assert.deepEqual(await problems(), []);
  pass("the example player script (pasted from tests/prototypes/scripts) has no problems attached to the player, and is an error naming the node when attached to one with no shape");

  // ---- Export: nothing to warn about, and a real ROM.
  await tab("3D");
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 120000);
  const log = await body();
  assert.doesNotMatch(log, /does nothing in the game|stops nothing/);
  assert.equal(readFileSync(ROM_PATH).subarray(0, 8).toString(), "HOMEBREW");
  await saveProject();
  const game = readProject();
  const find = (n, name) => (n.name === name ? n : n.children.map((c) => find(c, name)).find(Boolean));
  assert.equal(find(game.scene, "FloorShape").collision.solid, true);
  assert.deepEqual(find(game.scene, "FloorShape").collision.size, { x: 7, y: 1, z: 3 });
  assert.equal(find(game.scene, "WallShape").collision.solid, true);
  assert.notEqual(find(game.scene, "PlayerShape").collision?.solid, true);
  assert.equal(game.scripts.length, 1);
  console.log(`SAVED ${PROJECT_PATH}`);
  pass("exporting the level warns about nothing (the body's shape and the solid shapes are all used), builds a real .nds, and the saved file has the solid floor and wall");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "platformer-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
