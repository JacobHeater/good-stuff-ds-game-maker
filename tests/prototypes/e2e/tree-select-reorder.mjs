// Prototype E2E for selecting several nodes and reordering them in the Scene tree (requirements/node-list/STORY.select-and-reorder-nodes.md). Drives the built Electron app
// over CDP: real clicks with Ctrl and Shift held, real key presses, and drag and drop played as the DOM drag events a drag makes (the browser's own drag can't be
// driven over CDP), with the New Project location dialog stubbed.
//
//   pnpm build && node tests/prototypes/e2e/tree-select-reorder.mjs
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-tree-")).replace(/\\/g, "/");
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
const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const addNode = async (kind) => { await click("Scene"); await sleep(150); await click(kind, { endsWith: true }); await sleep(250); };
/** The tree as indented names, one per row, in order. */
const rows = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=tree-row]")].map((r) => `${Math.round((parseFloat(r.style.paddingLeft) - 8) / 14)}:${r.querySelector("span.flex-1").textContent.trim()}`));
const selectedNames = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=tree-row][data-selected=true]")].map((r) => r.querySelector("span.flex-1").textContent.trim()));
const rowBox = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[data-testid=tree-row]")].find((r) => r.querySelector("span.flex-1").textContent.trim() === name);
  if (!row) throw new Error(`no row ${name}`);
  const b = row.getBoundingClientRect();
  return { x: b.left + 40, y: b.top + b.height / 2, top: b.top, height: b.height };
}, name);
/** A click on a tree row with modifier keys held (real mouse events). */
async function clickRow(name, modifiers = []) {
  const { x, y } = await rowBox(name);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(x, y);
  for (const m of modifiers.slice().reverse()) await page.keyboard.up(m);
  await sleep(150);
}
/** Plays the DOM events of dragging row `from` onto row `to` at `fraction` of the way down it (0 = top edge, 0.5 = middle, 1 = bottom edge). */
async function dragRow(from, to, fraction) {
  await page.evaluate(async (from, to, fraction) => {
    const find = (name) => [...document.querySelectorAll("[data-testid=tree-row]")].find((r) => r.querySelector("span.flex-1").textContent.trim() === name);
    const wait = () => new Promise((r) => setTimeout(r, 60));
    const data = new DataTransfer();
    const source = find(from);
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }));
    await wait();
    const target = find(to);
    const box = target.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 40, clientY: box.top + box.height * fraction };
    target.dispatchEvent(new DragEvent("dragover", init));
    await wait();
    target.dispatchEvent(new DragEvent("drop", init));
    await wait();
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: data }));
    await wait();
  }, from, to, fraction);
  await sleep(150);
}
const press = async (key) => { await page.keyboard.press(key); await sleep(250); };
const undo = async () => { await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(250); };

/** Clicks the fold arrow of a row. */
const toggleRow = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[data-testid=tree-row]")].find((r) => r.querySelector("span.flex-1").textContent.trim() === name);
  row.querySelector("[data-testid=tree-toggle]").click();
}, name);
const hiddenCount = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[data-testid=tree-row]")].find((r) => r.querySelector("span.flex-1").textContent.trim() === name);
  return row.querySelector("[data-testid=tree-hidden-count]")?.textContent ?? null;
}, name);
const hasToggle = (name) => page.evaluate((name) => Boolean([...document.querySelectorAll("[data-testid=tree-row]")].find((r) => r.querySelector("span.flex-1").textContent.trim() === name).querySelector("[data-testid=tree-toggle]")), name);

try {
  await waitFor("http://127.0.0.1:9333/json/version");
  await waitFor("http://127.0.0.1:9229/json");
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null });
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes("index.html"));
    if (!page) await sleep(500);
  }
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });
  await mainEval(`(() => { const req = (process.mainModule && process.mainModule.require) || require; req("electron").dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(work + "/t.gsds")} }); return 1; })()`);
  await waitText("New Project");
  await click("New Project");
  await page.type("input[type=text]", "Tree");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // Main > [Node2D > [Label], Sprite2D, Camera2D, TileMap]: add four nodes under the root, then a Label under the first.
  for (const kind of ["Node2D", "Sprite2D", "Camera2D", "TileMap"]) {
    await clickRow("Main");
    await addNode(kind);
  }
  await clickRow("Node2D");
  await addNode("Label");
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Label", "1:Sprite2D", "1:Camera2D", "1:TileMap"]);

  // ---- Ctrl+click adds and removes; Shift+click selects a range; a plain click goes back to one.
  await clickRow("Sprite2D");
  await clickRow("TileMap", ["Control"]);
  assert.deepEqual((await selectedNames()).sort(), ["Sprite2D", "TileMap"]);
  assert.match(await page.evaluate(() => document.querySelector("[data-testid=multi-selection-note]")?.textContent ?? ""), /2 nodes are selected/);
  await clickRow("Sprite2D", ["Control"]);
  assert.deepEqual(await selectedNames(), ["TileMap"], "Ctrl+click on a selected node takes it out");
  await clickRow("Label");
  await clickRow("Camera2D", ["Shift"]);
  assert.deepEqual((await selectedNames()).sort(), ["Camera2D", "Label", "Sprite2D"], "Shift+click selects every row from Label down to Camera2D");
  await clickRow("Node2D");
  assert.deepEqual(await selectedNames(), ["Node2D"]);
  assert.equal(await page.evaluate(() => document.querySelector("[data-testid=multi-selection-note]")), null, "a single selection has no note");
  pass("Ctrl+click adds and removes a row, Shift+click selects the range from the last click, a plain click selects one");

  // ---- Delete and Duplicate act on the whole selection, as one undo step each.
  await clickRow("Sprite2D");
  await clickRow("TileMap", ["Control"]);
  await press("Delete");
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Label", "1:Camera2D"]);
  await undo();
  assert.equal((await rows()).length, 6, "one Ctrl+Z brings both back");
  await clickRow("Sprite2D");
  await clickRow("Camera2D", ["Control"]);
  await page.keyboard.down("Control"); await page.keyboard.press("d"); await page.keyboard.up("Control"); await sleep(300);
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Label", "1:Sprite2D", "1:Sprite2D2", "1:Camera2D", "1:Camera2D2", "1:TileMap"]);
  assert.deepEqual((await selectedNames()).sort(), ["Camera2D2", "Sprite2D2"], "the copies are selected");
  await undo();
  assert.equal((await rows()).length, 6);
  pass("Delete and Ctrl+D act on every selected row (the copies get their own names), each as one undo step");

  // ---- Reordering: drop on the top edge (before), the bottom edge (after) and the middle (inside).
  await clickRow("TileMap");
  await dragRow("TileMap", "Sprite2D", 0.05);
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Label", "1:TileMap", "1:Sprite2D", "1:Camera2D"], "dropped on the top edge of Sprite2D: before it");
  await dragRow("TileMap", "Camera2D", 0.95);
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Label", "1:Sprite2D", "1:Camera2D", "1:TileMap"], "dropped on the bottom edge of Camera2D: after it");
  await dragRow("Camera2D", "Node2D", 0.5);
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Label", "2:Camera2D", "1:Sprite2D", "1:TileMap"], "dropped on the middle of Node2D: inside it, last");
  await undo();
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Label", "1:Sprite2D", "1:Camera2D", "1:TileMap"], "one Ctrl+Z undoes a move");
  pass("dragging a row onto another's top edge, bottom edge or middle moves it before, after or inside it, one undo step each");

  // ---- Dragging a selected row drags the whole selection; a node can't be dropped into itself.
  await clickRow("Sprite2D");
  await clickRow("TileMap", ["Control"]);
  await dragRow("TileMap", "Label", 0.05);
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Sprite2D", "2:TileMap", "2:Label", "1:Camera2D"], "both selected rows moved together");
  const before = await rows();
  await dragRow("Node2D", "Label", 0.5);
  assert.deepEqual(await rows(), before, "Node2D can't be dropped into its own child");
  await dragRow("Camera2D", "Main", 0.05);
  assert.deepEqual(await rows(), before, "nothing can be dropped beside the scene root");
  pass("dragging a selected row moves the whole selection; a drop into itself or beside the root does nothing");

  // ---- Folding: the arrow hides a node's children (with a count), and the header buttons fold or unfold everything.
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "2:Sprite2D", "2:TileMap", "2:Label", "1:Camera2D"]);
  assert.equal(await hasToggle("Node2D"), true);
  assert.equal(await hasToggle("Camera2D"), false, "a node with no children has no arrow");
  await toggleRow("Node2D");
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "1:Camera2D"]);
  assert.equal(await hiddenCount("Node2D"), "3", "the row says how many nodes are hidden inside");
  await toggleRow("Node2D");
  assert.equal((await rows()).length, 6);
  await page.click("[data-testid=collapse-all]");
  await sleep(150);
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "1:Camera2D"]);
  await page.click("[data-testid=expand-all]");
  await sleep(150);
  assert.equal((await rows()).length, 6);
  // Folding a node with a selected child moves the selection to the folded node; a fold is not an undo step.
  await clickRow("TileMap");
  await toggleRow("Node2D");
  assert.deepEqual(await selectedNames(), ["Node2D"]);
  await undo();
  // The undo took back the last edit (the move of two nodes out of Node2D); Node2D, with only Label left in it, is still folded.
  assert.deepEqual(await rows(), ["0:Main", "1:Node2D", "1:Sprite2D", "1:Camera2D", "1:TileMap"], "an undo does not touch the fold");
  assert.equal(await hiddenCount("Node2D"), "1");
  pass("the arrow folds a node's children away (with a count of what is hidden), Collapse all and Expand all fold everything, a fold is not an undo step");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "tree-select-reorder-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
