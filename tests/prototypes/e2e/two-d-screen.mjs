// Prototype E2E for choosing the 2D screen of a 3D project (requirements/scene-designer/STORY.choose-2d-screen-in-3d-project.md). Drives the built Electron app
// over CDP with real clicks and typing, stubbing only the native file dialogs: New Project asks which screen is 2D (3D goes on the other), the toolbar's 2D screen
// swaps them (one undo step), the viewport shows the 3D editor on the 3D screen and a 2D screen editor on the other, 2D nodes can be added, the choice is saved
// and comes back, and Export ROM builds the 3D on the chosen screen (warning that the 2D node isn't drawn yet).
//
//   pnpm build && node tests/prototypes/e2e/two-d-screen.mjs
//
// Needs tools/ds-toolchain for the export. Uses ports 9333 and 9229; close other instances first.
// It prints `SAVED <path>`; GSDS_TWO_D_ROM_PROJECT=<path> pnpm test:rom then runs that project in melonDS: the cube is drawn on the BOTTOM screen (2D was put on top).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-2dscreen-e2e-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/twod.gsds`;
const ROM_PATH = `${work}/twod.nds`;
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
const clickStartingWith = (label) => page.evaluate((label) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(label));
  if (!b) throw new Error(`no button starting "${label}"`);
  b.click();
}, label);
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
/** Rows of the Scene Tree as [name, screen tag]. */
const rows = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => [r.querySelector("span.flex-1")?.textContent.trim(), r.querySelectorAll("span")[2]?.textContent.trim().toLowerCase()]).filter(([n]) => n));
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(200);
};
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
const tab = async (name) => { await click(name); await sleep(300); };
const selectValue = (label, value) => page.evaluate((label, value) => {
  const select = document.querySelector(`select[aria-label="${label}"]`);
  if (!select) throw new Error(`no select "${label}"`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, label, value);
const selectIs = (label) => page.evaluate((label) => document.querySelector(`select[aria-label="${label}"]`)?.value ?? null, label);
const radios = (groupLabel) => page.evaluate((groupLabel) => {
  const group = [...document.querySelectorAll("[role=radiogroup]")].find((g) => document.getElementById(g.getAttribute("aria-labelledby"))?.textContent.trim() === groupLabel);
  return group ? [...group.querySelectorAll("[role=radio]")].map((r) => [r.querySelector("span")?.textContent.trim(), r.getAttribute("aria-checked") === "true"]) : null;
}, groupLabel);
const setVector = async (label, values) => {
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
};
/** What the editor's central area is showing. */
const viewport = () => page.evaluate(() => ({
  threeD: !!document.querySelector("canvas"),
  text: [...document.querySelectorAll("span")].map((s) => s.textContent.trim()).filter((t) => /screen ·/i.test(t)).join(" | ").toLowerCase(),
  markers: document.querySelectorAll("[class*='cursor-grab']").length,
  hint: !!document.querySelector("[data-testid=empty-2d-screen]")
}));

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

  // ---- New Project asks which screen is 2D, for a 3D project only.
  await answerSave(PROJECT_PATH);
  await click("New Project");
  await page.type("input[type=text]", "TwoD");
  assert.equal(await page.evaluate(() => !!document.querySelector("[data-testid=two-d-screen-choice]")), false, "no 2D screen question before a mode is chosen");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  assert.equal(await page.evaluate(() => !!document.querySelector("[data-testid=two-d-screen-choice]")), false, "and none for a 2D project (both its screens are 2D)");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await sleep(150);
  assert.equal(await page.evaluate(() => !!document.querySelector("[data-testid=two-d-screen-choice]")), true, "a 3D project is asked");
  assert.deepEqual((await radios("2D screen")).map(([label, on]) => [label, on]), [["2D on top", false], ["2D on bottom", true]], "bottom is chosen by default");
  await page.evaluate(() => [...document.querySelectorAll("[data-testid=two-d-screen-choice] button[role=radio]")].find((x) => x.textContent.startsWith("2D on top")).click());
  await sleep(100);
  assert.deepEqual((await radios("2D screen")).map(([, on]) => on), [true, false]);
  pass("New Project asks for the 2D screen only for a 3D project, with the bottom screen chosen to begin with");

  await click("Create Project…");
  await waitText("Scene Tree");
  assert.equal(readProject().scene.screen, "bottom", "2D on top means 3D on the bottom: the scene root (a Node3D) is on the bottom screen");
  assert.equal(await selectIs("2D screen"), "top");
  assert.equal(await selectIs("Screen"), "bottom", "the view starts on the 3D screen");
  let view = await viewport();
  assert.equal(view.threeD, true);
  assert.match(view.text, /bottom screen · 3d engine/);
  pass("a 3D project with 2D on top opens with 3D on the bottom screen: the toolbar says so and the 3D editor is showing the bottom screen");

  // ---- The Add Node menu offers the 2D nodes too.
  await menu("Scene");
  const menuText = (await body()).toLowerCase();
  assert.match(menuText, /add 3d node/);
  assert.match(menuText, /add 2d node \(the 2d screen\)/);
  for (const kind of ["Sprite2D", "Label", "Area2D", "MeshInstance3D"]) assert.ok(menuText.includes(kind.toLowerCase()), `${kind} is offered`);
  await click("MeshInstance3D", { endsWith: true }); // the menu is still open: add the cube from it
  await sleep(250);
  pass("Scene > Add Node offers the 3D nodes and, under a 2D screen heading, the 2D nodes");

  // ---- Build a cube seen by a camera, and a label for the 2D screen.
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 0, 6]);
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  await selectRow("MeshInstance3D");
  await addNode("Label"); // a 2D node is put under the root, not under the selected mesh
  await blurFocus();
  const tree = await rows();
  assert.deepEqual(tree, [["Main", "bottom"], ["MeshInstance3D", "bottom"], ["Camera3D", "bottom"], ["DirectionalLight3D", "bottom"], ["Label", "top"]]);
  pass("3D nodes are on the bottom (3D) screen and a Label on the top (2D) one, and the Label went under the root although a mesh was selected");

  // ---- The 2D screen has its own editor.
  await selectValue("Screen", "top");
  await sleep(400);
  view = await viewport();
  assert.equal(view.threeD, false, "the 3D editor is gone");
  assert.match(view.text, /top screen · 2d engine/);
  assert.equal(view.markers, 1, "the label is on the 2D screen");
  assert.equal(view.hint, false);
  await selectValue("Screen", "bottom");
  await sleep(400);
  assert.equal((await viewport()).threeD, true);
  pass("looking at the 2D screen shows a 2D editor with the Label on it; looking at the 3D screen shows the 3D editor");

  // ---- Swap the screens.
  await selectValue("2D screen", "bottom");
  await sleep(400);
  assert.equal(await selectIs("2D screen"), "bottom");
  assert.equal(await selectIs("Screen"), "top", "the view follows the 3D engine's screen");
  assert.deepEqual(await rows(), [["Main", "top"], ["MeshInstance3D", "top"], ["Camera3D", "top"], ["DirectionalLight3D", "top"], ["Label", "bottom"]]);
  view = await viewport();
  assert.equal(view.threeD, true);
  assert.match(view.text, /top screen · 3d engine/);
  assert.equal(readProject().scene.screen, "bottom", "the file on disk is still as saved");
  assert.match(await body(), /Unsaved changes/);
  assert.match(await body(), /2D screen is now the bottom screen; the 3D engine drives the top one/);
  await menu("Scene");
  assert.match(await body(), /Undo Put the 2D screen on the bottom/);
  await clickStartingWith("Undo Put the 2D screen on the bottom");
  await sleep(300);
  assert.equal(await selectIs("2D screen"), "top", "undo puts it back");
  assert.deepEqual((await rows()).map(([, s]) => s), ["bottom", "bottom", "bottom", "bottom", "top"]);
  await menu("Scene");
  await clickStartingWith("Redo Put the 2D screen on the bottom");
  await sleep(300);
  assert.equal(await selectIs("2D screen"), "bottom");
  await selectValue("2D screen", "top"); // and back, for the ROM
  await sleep(300);
  assert.equal(await selectIs("Screen"), "bottom");
  pass("the toolbar's 2D screen swaps every node's screen and the view in one step; it is unsaved until saved, and undo and redo work");

  // ---- Saved with the project and back again.
  await saveProject();
  const saved = readProject();
  const find = (n, name) => (n.name === name ? n : n.children.map((c) => find(c, name)).find(Boolean));
  assert.equal(saved.scene.screen, "bottom");
  assert.equal(find(saved.scene, "Label").screen, "top");
  assert.equal(find(saved.scene, "MeshInstance3D").screen, "bottom");
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await answerOpen(PROJECT_PATH);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  assert.equal(await selectIs("2D screen"), "top");
  assert.equal(await selectIs("Screen"), "bottom");
  assert.equal((await viewport()).threeD, true);
  pass("the choice is saved with the project (in the scene root's screen) and comes back on reopening, looking at the 3D screen");

  // ---- Export: the 3D is built on the chosen screen; the 2D node isn't drawn yet, and the log says so.
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 120000);
  const log = await body();
  assert.match(log, /Label/);
  assert.match(log, /top \(2D\) screen, and the ROM doesn't draw 2D nodes yet/);
  assert.equal(readFileSync(ROM_PATH).subarray(0, 8).toString(), "HOMEBREW");
  assert.ok(existsSync(ROM_PATH));
  console.log(`SAVED ${PROJECT_PATH}`);
  pass("Export ROM builds a real .nds and warns that the Label on the 2D screen isn't drawn yet");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "two-d-screen-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
