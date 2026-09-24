// Throwaway E2E: drives the built Electron app over CDP. Only the native OS
// dialogs are stubbed (from the main-process inspector); everything else —
// renderer UI, IPC, persistence layer, recents store, real files on disk — is the real thing.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/"); // repo apps/desktop, relative to this file
const work = mkdtempSync(join(tmpdir(), "gsds-e2e-")).replace(/\\/g, "/");
const userData = `${work}/userdata`;
const RECENTS_FILE = `${userData}/recent-projects.json`;
const results = [];
const pass = (name) => { results.push(name); console.log(`[PASS] ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(`${DESKTOP}/node_modules/electron/dist/electron.exe`, [".", "--remote-debugging-port=9333", "--inspect=9229", `--user-data-dir=${userData}`], {
  cwd: DESKTOP, env, stdio: "ignore"
});
const exited = new Promise((res) => app.once("exit", res));

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

const setDialogs = (savePath, openPath) => mainEval(`(() => {
  const req = (process.mainModule && process.mainModule.require) || require;
  const { dialog } = req("electron");
  globalThis.__save = ${JSON.stringify(savePath)};
  globalThis.__open = ${JSON.stringify(openPath)};
  if (!globalThis.__patched) {
    dialog.showSaveDialog = async () => globalThis.__save ? { canceled: false, filePath: globalThis.__save } : { canceled: true };
    dialog.showOpenDialog = async () => { globalThis.__openCalls = (globalThis.__openCalls || 0) + 1; return globalThis.__open ? { canceled: false, filePaths: [globalThis.__open] } : { canceled: true, filePaths: [] }; };
    globalThis.__patched = true;
  }
  return "ok";
})()`);
const openDialogCalls = () => mainEval("globalThis.__openCalls || 0");

let page;
const body = () => page.evaluate(() => document.body.innerText);
const buttons = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));
const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label);
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const waitGone = (text, timeout = 8000) => page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout }, text);
const shot = (name) => page.screenshot({ path: join(HERE, `${name}.png`) });
const sceneMenu = async () => { await click("Scene"); await sleep(150); };
const projectMenu = async () => { await click("Project"); await sleep(150); };
const selectOptions = () => page.$$eval("select", (sels) => [...sels[0].options].map((o) => o.textContent));
const recentsOnDisk = () => JSON.parse(readFileSync(RECENTS_FILE, "utf8"));
const rowFor = (path) => page.evaluate((p) => {
  const open = document.querySelector(`button[title="${p}"]`);
  if (!open) return null;
  const li = open.closest("li");
  return { text: li.innerText, disabled: open.disabled, hasMissing: li.innerText.includes("missing") };
}, path);
const clickRow = (path) => page.evaluate((p) => document.querySelector(`button[title="${p}"]`).click(), path);
const removeRow = (path) => page.evaluate((p) => document.querySelector(`button[title="${p}"]`).closest("li").querySelector("button[aria-label^=Remove]").click(), path);
const dialogShowing = () => page.evaluate(() => !!document.querySelector("[role=alertdialog]"));
const addNodeVia = async (label) => { await sceneMenu(); await click(label, { endsWith: true }); await sleep(200); };
const savedChildren = (path) => JSON.parse(readFileSync(path, "utf8")).scene.children.length;

try {
  await waitFor("http://127.0.0.1:9333/json/version");
  await waitFor("http://127.0.0.1:9229/json");
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null });
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes("index.html"));
    if (!page) await sleep(500);
  }
  assert.ok(page, "renderer page found");
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });

  // ============ Landing screen ============
  await waitText("Open Existing Project");
  let b = await buttons();
  assert.deepEqual(b.sort(), ["New Project", "Open Existing Project"].sort(), "landing shows exactly two actions");
  assert.ok(!(await body()).includes("Scene Tree"), "no editor behind the landing screen");
  await shot("1-landing");
  pass("landing screen: exactly New Project + Open Existing Project, no editor");

  // ---- Open Existing Project on a fresh install: empty state, no dialog until Browse
  await click("Open Existing Project");
  await waitText("No recent projects yet");
  b = await buttons();
  assert.ok(b.includes("Browse…") && b.includes("← Back"), "Browse + Back offered");
  assert.ok(!b.includes("Clear list"), "no Clear list when there is nothing to clear");
  assert.equal(await openDialogCalls(), 0, "the native dialog isn't opened by choosing Open Existing Project");
  await shot("1b-open-empty");
  await click("← Back");
  await waitText("New Project");
  assert.ok(!existsSync(RECENTS_FILE), "looking at the list doesn't create the recents file");
  pass("Open Existing Project shows an empty state (and Browse) on a fresh install; no dialog, no file created");

  // ============ New Project validation ============
  await click("New Project");
  await waitText("Project mode");
  await click("Create Project…");
  await waitText("Give the project a name.");
  let t = await body();
  assert.ok(t.includes("Choose 2D or 3D"), "mode error shown");
  pass("create with nothing entered is blocked, name + mode both prompted");

  await page.type("input[type=text]", "Cube Runner");
  await click("Create Project…");
  await waitText("Choose 2D or 3D");
  assert.equal(await mainEval("globalThis.__save === undefined"), true, "no dialog was reached without a mode");
  pass("name without a mode is still blocked (no default mode)");

  // ---- Create a 3D project
  const p3d = `${work}/cube-runner.gsds`;
  await setDialogs(p3d, null);
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  b = await buttons();
  assert.ok(b.includes("3D") && !b.includes("2D"), `3D project tabs: ${b.slice(0, 6)}`);
  assert.ok((await body()).includes("Cube Runner · 3D project"), "status bar shows locked mode");
  assert.ok(!(await body()).includes("Unsaved changes"), "a just-created project is not unsaved");
  await shot("3-editor-3d");
  pass("new 3D project opens locked to 3D and clean (no unsaved indicator)");

  // ---- New Project's Save As recorded the project
  let recents = recentsOnDisk();
  assert.equal(recents.formatVersion, 1);
  assert.equal(recents.projects.length, 1);
  assert.deepEqual({ path: recents.projects[0].path, name: recents.projects[0].name, mode: recents.projects[0].mode }, { path: p3d, name: "Cube Runner", mode: "3D" });
  assert.ok(!Number.isNaN(Date.parse(recents.projects[0].lastOpenedAt)), "lastOpenedAt is an ISO time");
  pass("creating a project records it (path, name, mode, lastOpenedAt) in recent-projects.json");

  // ---- Menus (unchanged)
  await sceneMenu();
  const PROJECT_ONLY = ["Open Project...", "Save Project", "Save Project As...", "Close Project", "New Scene", "Save Scene", "Close Scene"];
  b = await buttons();
  assert.ok(b.includes("Duplicate Node") && b.includes("Delete Node"));
  for (const label of PROJECT_ONLY) assert.ok(!b.includes(label), `Scene menu must not contain "${label}"`);
  await sceneMenu();
  await projectMenu();
  b = await buttons();
  const menuLabels = b.filter((x) => ["Open Project...", "Save Project", "Save Project As...", "Close Project"].includes(x));
  assert.deepEqual(menuLabels, ["Open Project...", "Save Project", "Save Project As...", "Close Project"]);
  await projectMenu();
  pass("Scene menu = node actions only; Project menu = Open/Save/Save As/Close only");

  // ============ Unsaved-changes indicator, and plain Save doesn't re-record ============
  await addNodeVia("MeshInstance3D");
  await waitText("Unsaved changes");
  assert.ok((await page.title()).startsWith("●"), `window title flags unsaved: ${await page.title()}`);
  pass("editing marks the project unsaved (status bar + window title)");

  const stamp = recentsOnDisk().projects[0].lastOpenedAt;
  await sleep(1100);
  await projectMenu();
  await click("Save Project");
  await waitText("Saved project to");
  await waitGone("Unsaved changes");
  assert.equal(savedChildren(p3d), 1);
  assert.equal(recentsOnDisk().projects[0].lastOpenedAt, stamp, "plain Save must not touch the recent list");
  assert.ok(!(await page.title()).startsWith("●"), "title indicator clears after save");
  pass("Save writes the edit, clears the unsaved indicator, and does not re-record (lastOpenedAt unchanged)");

  // ============ Close is clean -> no prompt; recents list -> open ============
  await projectMenu();
  await click("Close Project");
  await waitText("Open Existing Project");
  assert.equal(await dialogShowing(), false, "no prompt when nothing is unsaved");
  pass("closing a project with no unsaved edits shows no prompt");

  await click("Open Existing Project");
  await waitText("Cube Runner");
  let row = await rowFor(p3d);
  assert.ok(row && row.text.includes("Cube Runner") && row.text.includes("3D") && row.text.includes(p3d) && row.text.includes("Last opened"), `row content: ${row?.text}`);
  assert.equal(row.disabled, false);
  await shot("4-open-recents");
  pass("recent list row shows name, mode, path and last-opened time");

  const before = recentsOnDisk().projects[0].lastOpenedAt;
  await sleep(1100);
  const calls = await openDialogCalls();
  await clickRow(p3d);
  await waitText("Scene Tree");
  b = await buttons();
  assert.ok(b.includes("3D") && !b.includes("2D"), "opened from the list, locked to its stored 3D mode");
  assert.ok((await body()).includes("MeshInstance3D"), "saved node restored");
  assert.equal(await openDialogCalls(), calls, "opening from the list uses no native dialog");
  assert.ok(recentsOnDisk().projects[0].lastOpenedAt > before, "opening re-records it (lastOpenedAt moves forward)");
  assert.equal(recentsOnDisk().projects.length, 1, "re-recording doesn't duplicate");
  pass("clicking a recent row opens it in its own mode, with no dialog and no mode question; lastOpenedAt updated, no duplicate");

  // ============ Invalid file via Browse is refused in the panel ============
  const bad = `${work}/bad.gsds`;
  const good = JSON.parse(readFileSync(p3d, "utf8"));
  writeFileSync(bad, JSON.stringify({ formatVersion: 1, id: "x", name: "n", createdAt: "a", updatedAt: "b", scene: good.scene }));
  await projectMenu(); await click("Close Project");
  await waitText("Open Existing Project");
  await setDialogs(null, bad);
  await click("Open Existing Project");
  await waitText("Browse…");
  await click("Browse…");
  await waitText("Open failed");
  assert.ok((await buttons()).includes("Browse…"), "still on the open panel");
  assert.ok(!(await body()).includes("Scene Tree"), "no partial project loaded");
  assert.equal(recentsOnDisk().projects.some((p) => p.path === bad), false, "a failed open is not recorded");
  await shot("5-open-invalid");
  pass("Browse to an invalid project file: refused with the error shown in the panel, nothing loaded, nothing recorded");
  await click("← Back");

  // ---- Cancel from the save dialog keeps the New Project form
  await click("New Project");
  await page.type("input[type=text]", "Canceled");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  await setDialogs(null, null);
  await click("Create Project…");
  await sleep(600);
  assert.ok((await body()).includes("Project mode"), "still on the form after cancel");
  assert.equal(recentsOnDisk().projects.length, 1, "a canceled create records nothing");
  pass("cancelling the save dialog leaves the New Project form open and records nothing");

  // ---- Create a 2D project
  const p2d = `${work}/sprite-quest.gsds`;
  await setDialogs(p2d, null);
  await click("Create Project…");
  await waitText("Scene Tree");
  b = await buttons();
  assert.ok(b.includes("2D") && !b.includes("3D"));
  assert.deepEqual(await selectOptions(), ["Both Screens", "Top Screen", "Bottom Screen"]);
  assert.deepEqual(recentsOnDisk().projects.map((p) => p.path), [p2d, p3d], "newest first");
  pass("new 2D project: only the 2D tab, Both Screens allowed; recorded at the top of the list");

  // ---- Save As records the new location
  const p2dCopy = `${work}/sprite-quest-copy.gsds`;
  await setDialogs(p2dCopy, null);
  await projectMenu();
  await click("Save Project As...");
  await waitText("sprite-quest-copy.gsds");
  assert.deepEqual(recentsOnDisk().projects.map((p) => p.path), [p2dCopy, p2d, p3d]);
  assert.equal(JSON.parse(readFileSync(p2dCopy, "utf8")).mode, "2D");
  pass("Save Project As writes the new path and records it");

  // ============ Unsaved-changes guard: Close Project ============
  await addNodeVia("Sprite2D");
  await waitText("Unsaved changes");
  await projectMenu();
  await click("Close Project");
  await waitText("Save changes to");
  const dlg = await page.evaluate(() => document.querySelector("[role=alertdialog]").innerText);
  assert.ok(dlg.includes("Cancel") && dlg.includes("Don't Save") && dlg.includes("Save") && dlg.includes("close this project"), dlg);
  await shot("6-unsaved-dialog");
  await click("Cancel");
  await waitGone("Save changes to");
  assert.ok((await body()).includes("Unsaved changes"), "Cancel keeps the edits");
  assert.ok((await buttons()).includes("2D"), "Cancel keeps the project open");
  pass("Close Project with unsaved edits asks Save / Don't Save / Cancel; Cancel keeps everything as it was");

  // Escape cancels too
  await projectMenu();
  await click("Close Project");
  await waitText("Save changes to");
  await page.keyboard.press("Escape");
  await waitGone("Save changes to");
  assert.ok((await buttons()).includes("2D"));
  pass("Escape on the prompt is Cancel");

  // Don't Save discards
  const childrenBefore = savedChildren(p2dCopy);
  await projectMenu();
  await click("Close Project");
  await waitText("Save changes to");
  await click("Don't Save");
  await waitText("Open Existing Project");
  assert.equal(savedChildren(p2dCopy), childrenBefore, "Don't Save leaves the file as it was");
  pass("Don't Save discards the edits, closes, and leaves the file untouched");

  // Save then proceed
  await setDialogs(null, null);
  await click("Open Existing Project");
  await waitText("Last opened");
  await clickRow(p2dCopy);
  await waitText("Scene Tree");
  assert.ok(!(await body()).includes("Unsaved changes"), "reopened clean: the discarded edit is gone");
  await addNodeVia("Sprite2D");
  await waitText("Unsaved changes");
  await projectMenu();
  await click("Close Project");
  await waitText("Save changes to");
  await click("Save");
  await waitText("Open Existing Project");
  assert.equal(savedChildren(p2dCopy), childrenBefore + 1, "Save wrote the edit before closing");
  pass("Save then proceed: the edit is written, then the project closes");

  // ============ Unsaved-changes guard: Open (from menu and from the recent list) ============
  await click("Open Existing Project");
  await waitText("Last opened");
  await clickRow(p3d);
  await waitText("Scene Tree");
  await addNodeVia("MeshInstance3D");
  await waitText("Unsaved changes");
  const p3dChildren = savedChildren(p3d);
  await setDialogs(null, p2dCopy);
  const opensBefore = await openDialogCalls();
  await projectMenu();
  await click("Open Project...");
  await waitText("Save changes to");
  assert.ok((await page.evaluate(() => document.querySelector("[role=alertdialog]").innerText)).includes("open another project"));
  await click("Cancel");
  await waitGone("Save changes to");
  assert.ok((await body()).includes("Cube Runner · 3D project"), "Cancel keeps the current project");
  assert.ok((await body()).includes("Unsaved changes"));
  assert.equal(savedChildren(p3d), p3dChildren, "nothing was written");
  pass("Open Project... with unsaved edits asks first; Cancel keeps the current project and edits");

  await projectMenu();
  await click("Open Project...");
  await waitText("Save changes to");
  await click("Save");
  await waitText("Canceled · 2D project");
  assert.equal(savedChildren(p3d), p3dChildren + 1, "the 3D project was saved before being replaced");
  assert.ok((await buttons()).includes("2D") && !(await buttons()).includes("3D"));
  assert.ok(!(await body()).includes("Unsaved changes"), "the newly opened project is clean");
  pass("Open Project... > Save: saves the current project, then opens the other one locked to its own mode");

  // ============ Recents management: missing, remove, clear ============
  await projectMenu();
  await click("Close Project");
  await waitText("Open Existing Project");
  unlinkSync(p2dCopy); // the file goes missing behind the app's back
  await click("Open Existing Project");
  await waitText("Last opened");
  row = await rowFor(p2dCopy);
  assert.ok(row && row.hasMissing && row.disabled, `missing row should be flagged + disabled: ${JSON.stringify(row)}`);
  assert.ok(recentsOnDisk().projects.some((p) => p.path === p2dCopy), "a missing file is not auto-pruned from the store");
  assert.equal((await rowFor(p2d)).hasMissing, false);
  await shot("7-open-missing");
  pass("a recent project whose file is gone is shown flagged 'missing' and disabled, and is not pruned automatically");

  await removeRow(p2dCopy);
  await page.waitForFunction((p) => !document.querySelector(`button[title="${p}"]`), { timeout: 5000 }, p2dCopy);
  assert.ok(!recentsOnDisk().projects.some((p) => p.path === p2dCopy));
  assert.ok(existsSync(p2d) && existsSync(p3d), "removing an entry never deletes project files");
  assert.ok(await rowFor(p2d) && await rowFor(p3d), "the other entries are untouched");
  pass("Remove drops only that entry from the list and the store; project files are untouched");

  await click("Clear list");
  await waitText("No recent projects yet");
  assert.deepEqual(recentsOnDisk().projects, []);
  assert.ok(!(await buttons()).includes("Clear list"));
  assert.ok(existsSync(p2d) && existsSync(p3d));
  pass("Clear list empties the list and the store; files untouched");

  // ---- Browse still works, and records
  await setDialogs(null, p3d);
  await click("Browse…");
  await waitText("Scene Tree");
  assert.ok((await buttons()).includes("3D") && !(await buttons()).includes("2D"));
  assert.deepEqual(recentsOnDisk().projects.map((p) => p.path), [p3d]);
  pass("Browse… opens a project not in the list, locked to its mode, and records it");

  // ============ Closing the window with unsaved edits is held ============
  await addNodeVia("MeshInstance3D");
  await waitText("Unsaved changes");
  const p3dOnDisk = savedChildren(p3d);
  const windowsAfterClose = await mainEval(`(() => { const req = (process.mainModule && process.mainModule.require) || require; const { BrowserWindow } = req("electron"); BrowserWindow.getAllWindows()[0].close(); return BrowserWindow.getAllWindows().length; })()`);
  assert.equal(windowsAfterClose, 1, "the window is still open after a close attempt with unsaved edits");
  await waitText("Save changes to");
  assert.ok((await page.evaluate(() => document.querySelector("[role=alertdialog]").innerText)).includes("close the window"));
  await shot("8-close-window-prompt");
  await click("Cancel");
  await waitGone("Save changes to");
  assert.ok((await body()).includes("Unsaved changes"), "Cancel keeps the project and its edits");
  pass("closing the window with unsaved edits is held and asks first; Cancel keeps the window and edits");

  await mainEval(`(() => { const req = (process.mainModule && process.mainModule.require) || require; req("electron").BrowserWindow.getAllWindows()[0].close(); return 1; })()`);
  await waitText("Save changes to");
  await click("Don't Save").catch(() => {}); // the window closes under us; that's the point
  const code = await Promise.race([exited.then(() => "exited"), sleep(8000).then(() => "still running")]);
  assert.equal(code, "exited", "the app quits once the user chooses Don't Save");
  assert.equal(savedChildren(p3d), p3dOnDisk, "Don't Save on window close wrote nothing");
  pass("closing the window > Don't Save quits the app without writing the edit");

  console.log(`
${results.length} E2E checks passed.`);
} catch (err) {
  console.error("E2E FAILED:", err);
  try { if (page) await shot("failure"); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
