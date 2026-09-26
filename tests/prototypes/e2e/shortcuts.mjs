// Prototype E2E for the editor's keyboard shortcuts (packages/ui/src/editor/state/keyboard-shortcuts.ts). Real key presses in the built
// Electron app over CDP; only the native dialogs are stubbed (and record that they were asked for).
//
//   pnpm build && node tests/prototypes/e2e/shortcuts.mjs
//
// Uses ports 9333 and 9229; close other instances first. Does not press F5 (Play would start the emulator; play.mjs covers that button).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-keys-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/keys.gsds`;
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
// Dialogs answer "canceled" unless told a path, and count how often each was asked.
const installDialogs = () => mainEval(`(() => {
  const req = (process.mainModule && process.mainModule.require) || require;
  const { dialog } = req("electron");
  globalThis.__save = null; globalThis.__saveCalls = []; globalThis.__openCalls = [];
  dialog.showSaveDialog = async (...args) => { globalThis.__saveCalls.push(args[args.length - 1].title); return globalThis.__save ? { canceled: false, filePath: globalThis.__save } : { canceled: true }; };
  dialog.showOpenDialog = async (...args) => { globalThis.__openCalls.push(args[args.length - 1].title); return { canceled: true, filePaths: [] }; };
  return "ok";
})()`);
const answerSave = (p) => mainEval(`globalThis.__save = ${JSON.stringify(p)}`);
const saveCalls = () => mainEval("globalThis.__saveCalls.length");
const openCalls = () => mainEval("globalThis.__openCalls.length");

let page;
const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const addNode = async (kind) => { await click("Scene"); await sleep(150); await click(kind, { endsWith: true }); await sleep(250); };
const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => r.querySelector("span.flex-1")?.textContent.trim()).filter(Boolean));
const selectedRow = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].find((r) => r.className.includes("bg-editor-accent/25"))?.querySelector("span.flex-1")?.textContent.trim());
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(150);
};
const press = async (key, mods = []) => {
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
  await sleep(250);
};
const inspectorNumber = (label) => page.evaluate((label) => {
  const wrap = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === label);
  return Number(wrap.querySelector("input").value);
}, label);
/** Each menu item's label and the shortcut drawn beside it (from data-shortcut, also in aria-keyshortcuts). */
const menuShortcuts = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("button[aria-keyshortcuts]")].map((b) => [
  b.textContent.trim(),
  { attr: b.getAttribute("aria-keyshortcuts"), drawn: getComputedStyle(b.querySelector("[data-shortcut]"), "::after").content.replace(/^"|"$/g, "") }
])));
const isDirty = async () => (await body()).includes("Unsaved changes");
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());
const tabActive = (name) => page.evaluate((name) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === name);
  return b?.className.includes("bg-editor-accent") ?? false;
}, name);

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
  await page.type("input[type=text]", "Keys");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await answerSave(null);

  // ---- Ctrl+D duplicates the selection (and one Ctrl+Z takes the copy away).
  await addNode("Sprite2D");
  await press("d", ["Control"]);
  assert.deepEqual(await rowNames(), ["Main", "Sprite2D", "Sprite2D2"], "the copy is next to the original, with a name of its own");
  await press("z", ["Control"]);
  assert.deepEqual(await rowNames(), ["Main", "Sprite2D"], "one undo removes the copy");
  pass("Ctrl+D duplicates the selected node, and Ctrl+Z undoes it");

  // ---- Ctrl+D on the scene root does nothing.
  await selectRow("Main");
  await press("d", ["Control"]);
  assert.equal((await rowNames()).length, 2);
  pass("Ctrl+D on the scene root does nothing");

  // ---- Arrow keys nudge a 2D node: 1 pixel, 8 with Shift; a burst is one undo step.
  await selectRow("Sprite2D");
  const x0 = await inspectorNumber("Position X");
  const y0 = await inspectorNumber("Position Y");
  await press("ArrowRight");
  await press("ArrowRight");
  assert.equal(await inspectorNumber("Position X"), x0 + 2);
  await press("ArrowDown", ["Shift"]);
  assert.equal(await inspectorNumber("Position Y"), y0 + 8);
  await press("ArrowLeft");
  await press("ArrowUp");
  assert.equal(await inspectorNumber("Position X"), x0 + 1);
  assert.equal(await inspectorNumber("Position Y"), y0 + 7);
  await press("z", ["Control"]);
  assert.equal(await inspectorNumber("Position X"), x0, "a quick run of nudges is one undo step");
  assert.equal(await inspectorNumber("Position Y"), y0);
  pass("Arrow keys nudge the selected 2D node by 1 pixel (8 with Shift), and a burst is one undo step");

  // ---- Arrow keys in a field belong to the field.
  await selectRow("Sprite2D");
  await page.click("input[aria-label=Name]");
  await press("ArrowRight");
  assert.equal(await inspectorNumber("Position X"), x0, "the arrow moved the text cursor, not the node");
  await blurFocus();
  pass("Arrow keys in the Name field do not move the node");

  // ---- Escape selects the scene root; F2 focuses the Name field with its text selected.
  await selectRow("Sprite2D");
  await blurFocus();
  await press("Escape");
  assert.equal(await selectedRow(), "Main", "Escape selected the scene root");
  await selectRow("Sprite2D");
  await blurFocus();
  await press("F2");
  const focused = await page.evaluate(() => ({ label: document.activeElement?.getAttribute("aria-label"), selected: document.activeElement?.selectionEnd - document.activeElement?.selectionStart, length: document.activeElement?.value.length }));
  assert.equal(focused.label, "Name");
  assert.equal(focused.selected, focused.length, "the whole name is selected, so typing replaces it");
  await blurFocus();
  pass("Escape selects the scene root; F2 focuses the Name field with the name selected");

  // ---- Ctrl+S saves (no dialog: the project already has a file); Ctrl+Shift+S asks where.
  assert.equal(await isDirty(), true);
  await blurFocus();
  const before = await saveCalls();
  await press("s", ["Control"]);
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
  assert.equal(await saveCalls(), before, "no dialog for a project that has a file");
  assert.ok(existsSync(PROJECT_PATH) && statSync(PROJECT_PATH).size > 0);
  assert.ok(readFileSync(PROJECT_PATH, "utf8").includes("Sprite2D"), "the scene is in the file");
  await press("S", ["Control", "Shift"]);
  assert.equal(await saveCalls(), before + 1, "Save As asked for a location");
  pass("Ctrl+S saves to the project file without a dialog; Ctrl+Shift+S opens Save As");

  // ---- Ctrl+Shift+E starts an export (asks where the ROM goes), Ctrl+O asks which project to open.
  const exportsBefore = await saveCalls();
  await press("E", ["Control", "Shift"]);
  assert.equal(await saveCalls(), exportsBefore + 1, "Export ROM asked where to write the ROM");
  const opensBefore = await openCalls();
  await press("o", ["Control"]);
  assert.equal(await openCalls(), opensBefore + 1, "Open Project asked for a file");
  pass("Ctrl+Shift+E starts Export ROM and Ctrl+O starts Open Project");

  // ---- Ctrl+1 / 2 / 3 switch workspaces.
  await press("2", ["Control"]);
  assert.ok(await tabActive("Script"), "Ctrl+2 is the Script tab");
  await press("3", ["Control"]);
  assert.ok(await tabActive("Game"));
  await press("1", ["Control"]);
  assert.ok(await tabActive("2D"));
  pass("Ctrl+1, Ctrl+2 and Ctrl+3 switch between the 2D, Script and Game tabs");

  // ---- Ctrl+Y redoes; the menus show the shortcuts.
  await selectRow("Sprite2D");
  await blurFocus();
  await press("Delete");
  assert.deepEqual(await rowNames(), ["Main"]);
  await press("z", ["Control"]);
  await press("y", ["Control"]);
  assert.deepEqual(await rowNames(), ["Main"], "Ctrl+Y redid the delete");
  await press("z", ["Control"]);
  await click("Scene");
  await sleep(150);
  const scene = await menuShortcuts();
  assert.deepEqual(scene["Duplicate Node"], { attr: "Ctrl+D", drawn: "Ctrl+D" });
  assert.deepEqual(scene["Delete Node"], { attr: "Del", drawn: "Del" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.body.click());
  await click("Project");
  await sleep(150);
  const project = await menuShortcuts();
  for (const [label, shortcut] of [["Open Project...", "Ctrl+O"], ["Save Project", "Ctrl+S"], ["Save Project As...", "Ctrl+Shift+S"], ["Export ROM...", "Ctrl+Shift+E"]]) {
    assert.deepEqual(project[label], { attr: shortcut, drawn: shortcut });
  }
  pass("Ctrl+Y redoes, and the Scene and Project menus show the shortcuts");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "shortcuts-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
