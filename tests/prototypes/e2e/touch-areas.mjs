// Prototype E2E for touch areas in the editor (requirements/touch/TASK.touch-area-editor.md). Drives the built Electron app over CDP with real clicks and typing,
// stubbing only the native dialogs: a 2D project (TouchArea2D: Inspector size fields, the rectangle in the 2D viewport, undo, save and reopen) and a 3D project
// (TouchArea3D: the Add 3D Node list, the Inspector's shape and size fields, save), then an Export ROM of a 3D project with a script that asks both kinds.
//
//   pnpm build && node tests/prototypes/e2e/touch-areas.mjs
//
// Needs tools/ds-toolchain for the final export. Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-touch-e2e-")).replace(/\\/g, "/");
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
  globalThis.__save = null;
  dialog.showSaveDialog = async () => globalThis.__save ? { canceled: false, filePath: globalThis.__save } : { canceled: true };
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  return "ok";
})()`);
const answerSave = (p) => mainEval(`globalThis.__save = ${JSON.stringify(p)}`);

let page;
const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const menuItems = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => r.querySelector("span.flex-1")?.textContent.trim()).filter(Boolean));
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(150);
};
async function setNumber(label, value) {
  await page.evaluate((label, value) => {
    const wrap = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === label);
    if (!wrap) throw new Error(`no Inspector field "${label}"`);
    const input = wrap.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, label, value);
  await sleep(150);
}
const numberOf = (label) => page.evaluate((label) => {
  const wrap = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === label);
  return wrap ? Number(wrap.querySelector("input").value) : null;
}, label);
const rect = () => page.evaluate(() => {
  const el = document.querySelector("[data-testid=touch-area-rect]");
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return { width: Math.round(box.width), height: Math.round(box.height) };
});
const chord = async (key) => { await page.keyboard.down("Control"); await page.keyboard.press(key); await page.keyboard.up("Control"); await sleep(250); };
const newProject = async (name, mode, path) => {
  await answerSave(path);
  await click("New Project");
  await page.type("input[type=text]", name);
  await page.evaluate((mode) => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith(mode)).click(), mode);
  await click("Create Project…");
  await waitText("Scene Tree");
};
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const nodesOf = (path) => {
  const out = [];
  const walk = (n) => { out.push(n); n.children.forEach(walk); };
  walk(JSON.parse(readFileSync(path, "utf8")).scene);
  return out;
};

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

  // ---- 2D project: TouchArea2D is offered, and TouchArea3D is not.
  const P2 = `${work}/two-d.gsds`;
  await newProject("Touch2D", "2D", P2);
  await menu("Scene");
  const items2 = await menuItems();
  assert.ok(items2.some((t) => t.endsWith("TouchArea2D")), "Add 2D Node lists TouchArea2D");
  assert.ok(!items2.some((t) => t.endsWith("TouchArea3D")), "a 2D project has no TouchArea3D");
  await click("Scene"); // the same button closes the menu again
  await sleep(150);
  pass("a 2D project's Scene menu lists TouchArea2D and not TouchArea3D");

  // ---- Adding one draws its rectangle at its real size (2 screen pixels per DS pixel), and the Inspector edits it.
  await addNode("TouchArea2D");
  assert.deepEqual(await rowNames(), ["Main", "TouchArea2D"]);
  assert.equal(await numberOf("Width"), 64);
  assert.equal(await numberOf("Height"), 64);
  assert.deepEqual(await rect(), { width: 128, height: 128 }, "64 x 64 DS pixels drawn at 2 screen pixels each");
  pass("a new TouchArea2D is 64 x 64 and its dashed rectangle is drawn at that size in the 2D viewport");

  await setNumber("Width", 100);
  await setNumber("Height", 40);
  assert.deepEqual(await rect(), { width: 200, height: 80 }, "the viewport follows the Inspector: 100 x 40 at 2x");
  await setNumber("Width", 999);
  assert.equal(await numberOf("Width"), 256, "a width past the screen is held to 256");
  await chord("z");
  assert.equal(await numberOf("Width"), 100, "one Ctrl+Z undoes the typed width");
  pass("the Inspector's Width and Height resize the rectangle; a too-big value is clamped; typing is one undo step");

  // ---- Save and reopen.
  await saveProject();
  const saved2 = nodesOf(P2).find((n) => n.kind === "TouchArea2D");
  assert.deepEqual(saved2.touchArea2D, { width: 100, height: 40 });
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await click("Open Existing Project");
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Touch2D")).click());
  await waitText("Scene Tree");
  await sleep(400);
  assert.deepEqual(await rect(), { width: 200, height: 80 });
  pass("saving writes the size to the file, and reopening draws the same rectangle");

  // ---- 3D project: both kinds are offered; a TouchArea3D has a shape and size fields.
  await menu("Project");
  await click("Close Project");
  await waitText("New Project");
  const P3 = `${work}/three-d.gsds`;
  await newProject("Touch3D", "3D", P3);
  await menu("Scene");
  const items3 = await menuItems();
  assert.ok(items3.some((t) => t.endsWith("TouchArea3D")) && items3.some((t) => t.endsWith("TouchArea2D")));
  await click("Scene"); // the same button closes the menu again
  await sleep(150);
  await addNode("TouchArea3D");
  assert.ok((await rowNames()).includes("TouchArea3D"));
  const shape = await page.evaluate(() => document.querySelector("[data-testid=touch-area-3d] select")?.value);
  assert.equal(shape, "box");
  assert.deepEqual([await numberOf("Size X"), await numberOf("Size Y"), await numberOf("Size Z")], [1, 1, 1]);
  await setNumber("Size Y", 2.5);
  await page.evaluate(() => {
    const select = document.querySelector("[data-testid=touch-area-3d] select");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "sphere");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(200);
  assert.equal(await numberOf("Radius"), 0.5);
  assert.equal(await numberOf("Size X"), null, "a sphere has a radius, not a size");
  pass("a 3D project offers both kinds; a TouchArea3D has a shape select and Size X/Y/Z (box) or Radius (sphere)");

  await saveProject();
  const saved3 = nodesOf(P3).find((n) => n.kind === "TouchArea3D");
  assert.equal(saved3.touchArea3D.shape, "sphere");
  assert.equal(saved3.touchArea3D.size.y, 2.5);
  assert.equal(saved3.screen, "top", "the 3D scene is on the top screen by default");
  pass("the shape and sizes are saved with the project");

  // ---- Export ROM from a 3D project with a script that asks both kinds: builds, and the Output log carries the touch diagnostics.
  await selectRow("Main");
  await addNode("Camera3D");
  await selectRow("Main");
  await addNode("TouchArea2D");
  await selectRow("Main");
  await addNode("MeshInstance3D");
  await answerSave(`${work}/touch.nds`);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 90000);
  const log = await body();
  assert.match(log, /Warning \[TouchArea3D\]: No script asks this touch area/);
  assert.match(log, /Warning \[TouchArea3D\]: This TouchArea3D can never be touched: the 3D scene is on the top screen/);
  assert.match(log, /Warning \[TouchArea2D\]: No script asks this touch area/);
  assert.ok(readFileSync(`${work}/touch.nds`).subarray(0, 8).toString() === "HOMEBREW");
  pass("Export ROM builds a 3D project with touch areas, warning about an area no script asks and a TouchArea3D the stylus can't reach");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "touch-areas-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
