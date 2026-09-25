// Prototype E2E for undo/redo (requirements/scene-designer/TASK.undo-redo-for-scene-edits.md). Drives the built
// Electron app over CDP with REAL keyboard and mouse input: Ctrl+Z / Ctrl+Shift+Z, typing into an Inspector field,
// and dragging a gizmo handle. Only the native file dialogs are stubbed.
//
//   pnpm build && node tests/prototypes/e2e/undo-redo.mjs
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// pngjs comes from the compiler package (this folder has only puppeteer-core); used to find gizmo handles.
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const HOUSE = join(HERE, "models", "house.obj").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-undo-")).replace(/\\/g, "/");
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

let page;
const click = (label, { endsWith = false, startsWith = false } = {}) => page.evaluate((label, endsWith, startsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => {
    const t = x.textContent.trim();
    return endsWith ? t.endsWith(label) : startsWith ? t.startsWith(label) : t === label;
  });
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith, startsWith);
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
const inspectorTitle = () => page.evaluate(() => document.querySelector('input[aria-label="Name"]')?.value.trim() ?? null);
const getVector = (label) => page.evaluate((label) => {
  const heading = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === label && d.className.includes("text-[11px]"));
  if (!heading) return null;
  return [...heading.nextElementSibling.querySelectorAll("input")].map((i) => Number(i.value));
}, label);
const isDirty = async () => (await body()).includes("Unsaved changes");
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

/** Real key chords. */
async function chord(key, { shift = false } = {}) {
  await page.keyboard.down("Control");
  if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(200);
}
const undo = () => chord("z");
const redo = () => chord("z", { shift: true });

/** The Scene menu's Undo / Redo entries: label, shortcut hint and whether they're disabled. */
async function undoRedoItems() {
  await menu("Scene");
  const items = await page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((b) => /^(Undo|Redo)/.test(b.textContent.trim()))
    .map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })));
  await click("Scene"); // close the menu again
  await sleep(100);
  return items;
}
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};

async function canvasShot() {
  const el = await page.$("canvas");
  return { b64: await el.screenshot({ encoding: "base64" }), box: await el.boundingBox() };
}
function newColored(base, now) {
  const a = PNG.sync.read(Buffer.from(base.b64, "base64")), b = PNG.sync.read(Buffer.from(now.b64, "base64"));
  const scale = b.width / now.box.width;
  const red = [], all = [];
  for (let i = 0; i < b.data.length; i += 4) {
    if (Math.abs(b.data[i] - a.data[i]) + Math.abs(b.data[i + 1] - a.data[i + 1]) + Math.abs(b.data[i + 2] - a.data[i + 2]) < 90) continue;
    const r = b.data[i], g = b.data[i + 1], bl = b.data[i + 2];
    const px = i / 4, pt = [(px % b.width) / scale + now.box.x, Math.floor(px / b.width) / scale + now.box.y];
    if (r > 180 && g < 90 && bl < 90) { red.push(pt); all.push(pt); }
    else if ((g > 180 && r < 90 && bl < 90) || (bl > 180 && r < 90 && g < 90)) all.push(pt);
  }
  return { red, all };
}
async function drag(from, to, steps = 10) {
  await page.mouse.move(from[0], from[1]);
  await sleep(120);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    await sleep(25);
  }
  await page.mouse.up();
  await sleep(250);
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
  await mainEval(`(() => {
    const req = (process.mainModule && process.mainModule.require) || require;
    const { dialog } = req("electron");
    globalThis.__save = null; globalThis.__open = null;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__save });
    dialog.showOpenDialog = async () => globalThis.__open ? { canceled: false, filePaths: [globalThis.__open] } : { canceled: true, filePaths: [] };
    return "ok";
  })()`);
  const answerSave = (p) => mainEval(`globalThis.__save = ${JSON.stringify(p)}`);
  const answerOpen = (p) => mainEval(`globalThis.__open = ${JSON.stringify(p)}`);
  await waitText("New Project");

  // ---- Nothing happens (and nothing breaks) on the startup view.
  await undo();
  await redo();
  assert.ok((await body()).includes("New Project"), "still on the startup view");
  pass("Ctrl+Z and Ctrl+Shift+Z do nothing on the startup view");

  const projectPath = `${work}/undo.gsds`;
  await answerSave(projectPath);
  await click("New Project");
  await page.type("input[type=text]", "Undo");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- The Scene menu shows both entries with their shortcuts, disabled when there's nothing to do.
  let items = await undoRedoItems();
  assert.equal(items.length, 2);
  assert.ok(items[0].text.startsWith("Undo") && items[0].text.endsWith("Ctrl+Z") && items[0].disabled, `Undo disabled with its shortcut (${JSON.stringify(items[0])})`);
  assert.ok(items[1].text.startsWith("Redo") && items[1].text.endsWith("Ctrl+Shift+Z") && items[1].disabled, `Redo disabled with its shortcut (${JSON.stringify(items[1])})`);
  await undo();
  assert.deepEqual(await rowNames(), ["Main"], "undo with nothing to undo changes nothing");
  pass("the Scene menu offers Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z), both disabled on a fresh project");

  // ---- Undo and redo an added node, with its selection.
  await addNode("MeshInstance3D");
  assert.deepEqual(await rowNames(), ["Main", "MeshInstance3D"]);
  items = await undoRedoItems();
  assert.ok(items[0].text.startsWith("Undo Add MeshInstance3D") && !items[0].disabled, `the menu names the edit (${items[0].text})`);
  await undo();
  assert.deepEqual(await rowNames(), ["Main"], "Ctrl+Z removed the node");
  assert.ok((await body()).includes("Undid: Add MeshInstance3D."), "the Output log says so");
  items = await undoRedoItems();
  assert.ok(items[1].text.startsWith("Redo Add MeshInstance3D") && !items[1].disabled);
  await redo();
  assert.deepEqual(await rowNames(), ["Main", "MeshInstance3D"], "Ctrl+Shift+Z brought it back");
  assert.equal(await inspectorTitle(), "MeshInstance3D", "and selected it");
  pass("Ctrl+Z undoes an added node and Ctrl+Shift+Z redoes it and selects it; the menu and Output log name the edit");

  // ---- A new edit after undoing clears redo.
  await undo();
  await addNode("Camera3D");
  await redo();
  assert.deepEqual(await rowNames(), ["Main", "Camera3D"], "redo after a new edit did nothing");
  items = await undoRedoItems();
  assert.ok(items[1].disabled, "Redo is disabled again");
  pass("a new edit after an undo clears the redo stack");

  // ---- Typing into an Inspector field is one step, and Ctrl+Z works with the field focused.
  await selectRow("Camera3D");
  await page.click("input[type=number]"); // Position X
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
  await page.keyboard.type("1.25", { delay: 60 });
  assert.equal((await getVector("Position"))[0], 1.25);
  await undo(); // still focused in the field
  assert.equal((await getVector("Position"))[0], 0, "one Ctrl+Z undid all of '1.25'");
  await redo();
  assert.equal((await getVector("Position"))[0], 1.25);
  await blurFocus();
  pass("typing '1.25' into a field is one undo step, and Ctrl+Z works while the field has focus");

  // ---- Saved state reads as clean after undoing back to it; saving keeps history.
  await saveProject();
  assert.ok(!(await isDirty()));
  await addNode("Node3D");
  assert.ok(await isDirty());
  await undo();
  assert.ok(!(await isDirty()), "undoing back to the saved scene shows no unsaved changes");
  await redo();
  assert.ok(await isDirty(), "redoing shows unsaved changes again");
  await undo();
  await undo(); // past the save: undoes the typed position
  assert.equal((await getVector("Position"))[0], 0);
  assert.ok(await isDirty(), "undoing past the save makes the project dirty");
  await redo();
  assert.ok(!(await isDirty()), "and redoing back to it makes it clean");
  pass("undoing back to the saved state reads as clean; saving doesn't clear history; going past it reads as dirty");

  // ---- A gizmo drag is one step.
  await selectRow("Main");
  await addNode("MeshInstance3D");
  const meshName = (await rowNames()).at(-1);
  await page.click("input[type=number]");
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
  await page.keyboard.type("1.5"); // X
  await blurFocus();
  await sleep(300);
  await click("Select");
  await sleep(300);
  const base = await canvasShot();
  await click("Move");
  await sleep(300);
  const found = newColored(base, await canvasShot());
  assert.ok(found.red.length > 3 && found.all.length > 20, "the move gizmo is visible");
  const cx = found.all.reduce((s, p) => s + p[0], 0) / found.all.length;
  const cy = found.all.reduce((s, p) => s + p[1], 0) / found.all.length;
  const tip = found.red.reduce((best, p) => (Math.hypot(p[0] - cx, p[1] - cy) > Math.hypot(best[0] - cx, best[1] - cy) ? p : best), found.red[0]);
  const len = Math.hypot(tip[0] - cx, tip[1] - cy);
  const dir = [(tip[0] - cx) / len, (tip[1] - cy) / len];
  const before = await getVector("Position");
  await drag(tip, [tip[0] + dir[0] * 45, tip[1] + dir[1] * 45]);
  const afterFirst = await getVector("Position");
  assert.ok(Math.abs(afterFirst[0] - before[0]) > 0.15, `the drag moved X (${before} -> ${afterFirst})`);
  // A second drag starts right away: the gizmo has moved with the node, so grab the handle again.
  const base2 = await canvasShot();
  await click("Select"); await sleep(300);
  const clean2 = await canvasShot();
  await click("Move"); await sleep(300);
  const found2 = newColored(clean2, await canvasShot());
  assert.ok(found2.red.length > 3, "the gizmo is visible after the first drag");
  const cx2 = found2.all.reduce((s, p) => s + p[0], 0) / found2.all.length;
  const cy2 = found2.all.reduce((s, p) => s + p[1], 0) / found2.all.length;
  const tip2 = found2.red.reduce((best, p) => (Math.hypot(p[0] - cx2, p[1] - cy2) > Math.hypot(best[0] - cx2, best[1] - cy2) ? p : best), found2.red[0]);
  const len2 = Math.hypot(tip2[0] - cx2, tip2[1] - cy2);
  await drag(tip2, [tip2[0] + ((tip2[0] - cx2) / len2) * 45, tip2[1] + ((tip2[1] - cy2) / len2) * 45]);
  const afterSecond = await getVector("Position");
  assert.ok(Math.abs(afterSecond[0] - afterFirst[0]) > 0.15, `the second drag moved X again (${afterFirst} -> ${afterSecond})`);
  await undo();
  const undone = await getVector("Position");
  assert.ok(near(undone[0], afterFirst[0], 1e-4), `one Ctrl+Z undid only the second drag (${afterSecond} -> ${undone}, expected ${afterFirst})`);
  await undo();
  const undone2 = await getVector("Position");
  assert.ok(near(undone2[0], before[0], 1e-4), `the next Ctrl+Z undid the whole first drag, not one frame of it (${undone2}, expected ${before})`);
  await undo();
  assert.ok(near((await getVector("Position"))[0], 0, 1e-4), "and the typed 1.5 is the step after that");
  assert.equal((await rowNames()).at(-1), meshName, "the node itself is still there");
  pass("a gizmo drag is one undo step, two drags are two, however quickly the second follows");
  await click("Select");

  // ---- Delete is undoable and brings the node back selected.
  await redo(); await redo(); await redo();
  await selectRow(meshName);
  await menu("Scene");
  await click("Delete Node");
  await sleep(250);
  assert.ok(!(await rowNames()).includes(meshName));
  await undo();
  assert.ok((await rowNames()).includes(meshName), "Ctrl+Z brought the deleted node back");
  assert.equal(await inspectorTitle(), meshName, "and selected it");
  pass("a deleted node comes back selected");

  // ---- Importing a model is undoable, including the model in the project.
  await selectRow("Main");
  await answerOpen(HOUSE);
  await menu("Scene");
  await click("Import Model (.obj)...");
  await waitText('Imported model "house"');
  await saveProject();
  assert.ok("meshes" in JSON.parse(readFileSync(projectPath, "utf8")), "the saved file has the model");
  await undo();
  assert.ok(!(await rowNames()).includes("house"), "Ctrl+Z removed the model's node");
  assert.ok(await isDirty());
  await saveProject();
  assert.ok(!("meshes" in JSON.parse(readFileSync(projectPath, "utf8"))), "and the model is out of the project file too");
  await redo();
  assert.ok((await rowNames()).includes("house"));
  await saveProject();
  assert.equal(JSON.parse(readFileSync(projectPath, "utf8")).meshes.length, 1, "redo put the model back");
  pass("importing a model can be undone and redone, and the model leaves and rejoins the project file");

  // ---- Non-edits aren't undone.
  await click("Rotate");
  await undo();
  const pressed = await page.evaluate(() => [...document.querySelectorAll("[aria-label=Tools] button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent.trim()));
  assert.deepEqual(pressed, ["Rotate"], "undo left the tool alone");
  assert.ok(!(await rowNames()).includes("house"), "and undid the last scene edit instead");
  pass("choosing a tool isn't undoable; Ctrl+Z undoes the last scene edit instead");

  // ---- The menu entries work too.
  await redo();
  await menu("Scene");
  await click("Undo", { startsWith: true });
  await sleep(200);
  assert.ok(!(await rowNames()).includes("house"), "the Undo menu entry undid the import");
  await menu("Scene");
  await click("Redo", { startsWith: true });
  await sleep(200);
  assert.ok((await rowNames()).includes("house"), "the Redo menu entry redid it");
  pass("the Scene menu's Undo and Redo entries work");

  // ---- Not while the unsaved-changes prompt is open.
  await selectRow("Main");
  await addNode("Node3D"); // an unsaved edit, so closing asks first
  assert.ok(await isDirty());
  await menu("Project");
  await click("Close Project");
  await page.waitForSelector("[role=alertdialog]");
  const rowsBefore = await rowNames();
  await undo();
  assert.ok(await page.$("[role=alertdialog]"), "the prompt is still up");
  assert.deepEqual(await rowNames(), rowsBefore, "Ctrl+Z did nothing behind the prompt");
  await click("Cancel");
  pass("Ctrl+Z does nothing while the unsaved-changes prompt is open");

  // ---- History doesn't cross projects.
  await saveProject();
  await menu("Project");
  await click("Close Project");
  await waitText("New Project");
  await answerSave(`${work}/second.gsds`);
  await click("New Project");
  await page.type("input[type=text]", "Second");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await undo();
  assert.deepEqual(await rowNames(), ["Main"], "the first project's edits weren't applied to the second");
  items = await undoRedoItems();
  assert.ok(items[0].disabled && items[1].disabled, "the new project starts with nothing to undo or redo");
  assert.ok(!(await isDirty()));
  pass("history doesn't cross project boundaries");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "undo-redo-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
