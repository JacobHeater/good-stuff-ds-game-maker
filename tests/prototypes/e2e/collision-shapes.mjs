// Prototype E2E for collision shapes (requirements/collision/STORY.collision-shapes-and-overlap-checks.md and its tasks, and
// requirements/properties-panel/STORY.rename-a-node.md). Drives the built Electron app over CDP with real typing and clicks and stubs only the
// native file dialogs: the shape in the Inspector, the wireframe in the 3D viewport (read from screenshots), renaming nodes, `overlaps()` in the
// Script tab, the Export ROM warning for a shape nothing checks, save and reopen, and finally a small game authored entirely through the UI.
//
//   pnpm build && node tests/prototypes/e2e/collision-shapes.mjs
//
// Needs tools/ds-toolchain for the export. Uses ports 9333 and 9229; close other instances first.
// It prints `SAVED <path>` for the game it built; GSDS_COLLISION_ROM_PROJECT=<path> pnpm test:rom then runs that project in melonDS with the D-pad
// held and checks that the flag appears exactly when the player's shape overlaps the wall's.
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
const work = mkdtempSync(join(tmpdir(), "gsds-collision-e2e-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/collision.gsds`;
const ROM_PATH = `${work}/collision.nds`;
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

const STOP_X = 1.6;
const SCRIPT = `func _process(delta):\n    if Input.is_button_down("right"):\n        position.x = min(position.x + 0.05, ${STOP_X})\n    $Flag.visible = $PlayerShape.overlaps($WallShape)\n`;

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
  await page.type("input[type=text]", "Collision");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await tab("3D");

  // ---- A new collision shape is a unit box, and only shapes have the field.
  await addNode("MeshInstance3D");
  assert.equal(await shapeState(), null, "a mesh has no Shape field");
  await selectRow("Main");
  await addNode("CollisionShape3D");
  assert.equal(await nameField(), "CollisionShape3D");
  assert.deepEqual(await shapeState(), { shape: "box", sizeX: 1, sizeY: 1, sizeZ: 1, radius: null, height: null });
  assert.match(await body(), /does nothing until a script passes it to overlaps\(\)/);
  pass("a new CollisionShape3D is a 1 x 1 x 1 box with its size fields and a hint; a mesh has no Shape field");

  // ---- Editing: the fields follow the shape, sizes are remembered, a capsule stays a capsule.
  await chooseShape("sphere");
  assert.deepEqual(await shapeState(), { shape: "sphere", sizeX: null, sizeY: null, sizeZ: null, radius: 0.5, height: null });
  await typeShapeNumber("Radius", "1.5");
  assert.equal((await shapeState()).radius, 1.5);
  await chooseShape("capsule");
  assert.deepEqual(await shapeState(), { shape: "capsule", sizeX: null, sizeY: null, sizeZ: null, radius: 1.5, height: 3 });
  await chooseShape("cylinder");
  assert.deepEqual(await shapeState(), { shape: "cylinder", sizeX: null, sizeY: null, sizeZ: null, radius: 1.5, height: 3 });
  await typeShapeNumber("Height", "0.8");
  assert.equal((await shapeState()).height, 0.8, "a cylinder can be shorter than it is wide");
  await chooseShape("box");
  await typeShapeNumber("Size Y", "2");
  assert.deepEqual(await shapeState(), { shape: "box", sizeX: 1, sizeY: 2, sizeZ: 1, radius: null, height: null });
  await chooseShape("sphere");
  assert.equal((await shapeState()).radius, 1.5, "changing the shape back and forth keeps each shape's size");
  pass("the fields follow the shape (size X/Y/Z, radius, height); a capsule is raised to twice its radius; sizes are remembered per shape; typing 1.5 isn't clamped half way");

  // ---- Undo: typing is one step, the shape is its own.
  await blurFocus();
  await typeShapeNumber("Radius", "2.25");
  await blurFocus();
  assert.equal((await shapeState()).radius, 2.25);
  await chord("z");
  assert.equal((await shapeState()).radius, 1.5, "one Ctrl+Z undoes the whole typed number");
  await chord("z");
  assert.equal((await shapeState()).shape, "box", "the next Ctrl+Z undoes the shape change");
  await chord("z", { shift: true });
  await chord("z", { shift: true });
  assert.equal((await shapeState()).radius, 2.25, "and redo brings both back");
  pass("Ctrl+Z undoes a typed number in one step and a shape change in another; Ctrl+Shift+Z redoes them");

  // ---- Renaming.
  await renameSelected("CoinShape");
  assert.ok((await rowNames()).includes("CoinShape"));
  assert.ok(!(await rowNames()).includes("CollisionShape3D"));
  assert.ok(await isDirty());
  await chord("z");
  assert.ok((await rowNames()).includes("CollisionShape3D"), "one Ctrl+Z restores the name");
  await chord("z", { shift: true });
  assert.equal(await nameField(), "CoinShape");
  // Clearing the field doesn't rename the node to nothing; leaving it puts the name back.
  await page.focus('input[aria-label="Name"]');
  await page.evaluate(() => document.querySelector('input[aria-label="Name"]').select());
  await page.keyboard.press("Backspace");
  await sleep(200);
  assert.ok((await rowNames()).includes("CoinShape"), "an empty name is not applied");
  await blurFocus();
  await sleep(150);
  assert.equal(await nameField(), "CoinShape");
  await page.focus('input[aria-label="Name"]');
  await page.evaluate(() => document.querySelector('input[aria-label="Name"]').select());
  await page.keyboard.type("  Padded  ");
  await sleep(200);
  await blurFocus();
  assert.ok((await rowNames()).includes("Padded"), "the name is trimmed");
  await renameSelected("CoinShape");
  pass("renaming from the Inspector changes the Scene tree, is undoable, ignores an empty name and trims spaces");

  // ---- The viewport draws the shape, and a click on it selects it.
  await selectRow("Main");
  await sleep(400);
  await page.screenshot({ path: join(HERE, "collision-viewport.png") });
  const teal = await countPixels(isTeal);
  const blueBaseline = await countPixels(isBlue);
  assert.ok(teal > 1500, `the wireframe is drawn in the shape color when the shape isn't selected (${teal} pixels)`);
  await selectRow("CoinShape");
  await sleep(400);
  await page.screenshot({ path: join(HERE, "collision-viewport-selected.png") });
  const blue = await countPixels(isBlue);
  assert.ok(blue - blueBaseline > 800, `and in the accent color when it is selected (${blue} blue pixels against ${blueBaseline} without it)`);
  assert.ok((await countPixels(isTeal)) < teal / 3, "and no longer in the shape color");
  // A hidden shape isn't drawn.
  const toggleVisible = () => page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Visible").querySelector("input").click());
  await toggleVisible();
  await sleep(400);
  assert.ok((await countPixels(isBlue)) - blueBaseline < 200 && (await countPixels(isTeal)) < teal / 6, "a hidden shape isn't drawn");
  await toggleVisible();
  await sleep(300);
  await selectRow("Main");
  await sleep(300);
  const { clip } = await viewportPixels();
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2);
  await sleep(400);
  assert.equal(await nameField(), "CoinShape", "clicking the shape in the viewport selects its node");
  pass("the viewport draws collision shapes as wireframes (shape color, accent when selected, nothing when hidden) and clicking one selects its node");

  // ---- Shapes are saved.
  await chooseShape("capsule");
  await typeShapeNumber("Radius", "0.3");
  await typeShapeNumber("Height", "1.4");
  await blurFocus();
  await tab("3D");
  await saveProject();
  const saved = readProject();
  const savedShape = saved.scene.children.find((c) => c.kind === "CollisionShape3D");
  assert.equal(savedShape.name, "CoinShape");
  assert.equal(savedShape.collision.shape, "capsule");
  assert.equal(savedShape.collision.radius, 0.3);
  assert.equal(savedShape.collision.height, 1.4);
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await answerOpen(PROJECT_PATH);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  await selectRow("CoinShape");
  assert.deepEqual(await shapeState(), { shape: "capsule", sizeX: null, sizeY: null, sizeZ: null, radius: 0.3, height: 1.4 });
  await chooseShape("box");
  assert.deepEqual(await shapeState(), { shape: "box", sizeX: 1, sizeY: 2, sizeZ: 1, radius: null, height: null }, "the box size typed before is still remembered");
  await chooseShape("capsule");
  await tab("3D");
  await chord("z");
  await chord("z");
  assert.ok(!(await isDirty()), "and undoing the two shape changes made after reopening is clean again");
  pass("a capsule of radius 0.3 and height 1.4, and its name, survive save, close and reopen (with the box's earlier size still remembered)");

  // ---- A game, authored through the UI: a player and a wall with shapes, a hidden flag, a camera and a light.
  await selectRow("Main");
  await addNode("MeshInstance3D"); // the mesh added first, before the shape, is now "MeshInstance3D" (there is one already)
  await renameSelected("Player");
  await setVector("Position", [-1.5, -0.9, 0.5]);
  await addNode("CollisionShape3D");
  await renameSelected("PlayerShape");
  await chooseShape("box");
  await typeShapeNumber("Size Y", "1");
  await blurFocus();
  await selectRow("Main");
  await addNode("MeshInstance3D");
  await renameSelected("Wall");
  await setVector("Position", [2.2, -0.9, 0.5]);
  await addNode("CollisionShape3D");
  await renameSelected("WallShape");
  await chooseShape("box");
  await typeShapeNumber("Size Y", "1");
  await blurFocus();
  await selectRow("Main");
  await addNode("MeshInstance3D");
  await renameSelected("Flag");
  await setVector("Position", [0, 1.9, -0.5]);
  await setVector("Scale", [1.3, 1.3, 1.3]);
  await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Visible").querySelector("input").click());
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 0.5, 8]);
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  // The first mesh and the shape from before are in the scene too; keep the picture tidy by removing the leftover mesh and shape.
  await selectRow("CoinShape");
  await menu("Scene");
  await click("Delete Node");
  await sleep(250);
  await selectRow("MeshInstance3D");
  await menu("Scene");
  await click("Delete Node");
  await sleep(250);
  assert.deepEqual((await rowNames()).sort(), ["Camera3D", "DirectionalLight3D", "Flag", "Main", "Player", "PlayerShape", "Wall", "WallShape"].sort());
  pass("a small game is built through the UI: player and wall meshes each with a collision shape, a hidden flag, a camera and a light (every node named so a script can name it)");

  // ---- overlaps() in the Script tab, and what the editor and the export say.
  await tab("Script");
  await click("New Script", { within: "[data-testid=script-workspace]" });
  await sleep(500);
  await pasteSource('func _process(delta):\n    if $Player.overlaps($WallShape):\n        pass\n');
  const wrong = await problems();
  assert.equal(wrong.filter((p) => p.severity === "error").length, 1);
  assert.match(wrong[0].message, /overlaps\(\) works on CollisionShape3D nodes, but \$Player is a MeshInstance3D\. Add a CollisionShape3D under it and use that node's name\./);
  await pasteSource(SCRIPT);
  assert.deepEqual(await problems(), [], "overlaps on two shapes, with the flag shown and hidden by it, has no problems");
  await tab("3D");
  await selectRow("Player");
  await answerSave(ROM_PATH);
  // With the script not yet attached, both shapes are unused: the export says so, and still builds.
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 120000);
  const log = await body();
  assert.match(log, /Warning \[PlayerShape\]: No script passes this collision shape to overlaps\(\) or moves it as a body with move_and_collide\(\), so it does nothing in the game\./);
  assert.match(log, /Warning \[WallShape\]: No script passes this collision shape to overlaps\(\) or moves it as a body with move_and_collide\(\), so it does nothing in the game\./);
  pass("overlaps() on a mesh is an error that says what to do; on two shapes it is accepted; exporting with the script unattached warns about both shapes (and still builds)");

  const unusedWarnings = async () => ((await body()).match(/collision shape to overlaps\(\)/g) ?? []).length;
  const warningsBefore = await unusedWarnings();
  assert.equal(warningsBefore, 2);
  await chooseInspectorScript("Script");
  await menu("Project");
  await click("Export ROM...");
  await page.waitForFunction(() => (document.body.innerText.match(/Exported ROM to/g) ?? []).length >= 2, { timeout: 120000 });
  assert.equal(await unusedWarnings(), warningsBefore, "no new unused-shape warning once the script is attached");
  assert.equal(readFileSync(ROM_PATH).subarray(0, 8).toString(), "HOMEBREW");
  await saveProject();
  const game = readProject();
  const names = (n) => [n.name, ...n.children.flatMap(names)];
  assert.ok(["Player", "PlayerShape", "Wall", "WallShape", "Flag"].every((name) => names(game.scene).includes(name)));
  assert.equal(game.scripts.length, 1);
  console.log(`SAVED ${PROJECT_PATH}`);
  pass("with the script attached, the shapes are no longer reported, the export builds a real .nds, and the game is saved");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "collision-shapes-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
