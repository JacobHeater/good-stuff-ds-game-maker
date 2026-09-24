// Prototype E2E for "Export ROM..." (requirements/compiler/STORY.export-rom-from-project-menu.md).
// Drives the built Electron app over CDP, stubs only the native save dialog, and lets the REAL compiler
// run the REAL devkitPro toolchain, so it needs the toolchain installed (tools/ds-toolchain).
//
//   pnpm build && node tests/prototypes/e2e/export-rom.mjs
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-export-")).replace(/\\/g, "/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(`${DESKTOP}/node_modules/electron/dist/electron.exe`, [".", "--remote-debugging-port=9333", "--inspect=9229", `--user-data-dir=${work}/userdata`], {
  cwd: DESKTOP, env, stdio: "ignore"
});

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

/** Save dialog: answers with `__save` (null = cancel), and records every call's options. */
const installDialog = () => mainEval(`(() => {
  const req = (process.mainModule && process.mainModule.require) || require;
  const { dialog } = req("electron");
  globalThis.__saveCalls = [];
  globalThis.__save = null;
  dialog.showSaveDialog = async (...args) => {
    const options = args[args.length - 1];
    globalThis.__saveCalls.push({ title: options.title, defaultPath: options.defaultPath });
    return globalThis.__save ? { canceled: false, filePath: globalThis.__save } : { canceled: true };
  };
  return "ok";
})()`);
const answerSaveWith = (path) => mainEval(`globalThis.__save = ${JSON.stringify(path)}`);
const saveCalls = () => mainEval("globalThis.__saveCalls");

let page;
const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const buttonLabels = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const selectRow = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
  if (!row) throw new Error(`no scene tree row "${name}"`);
  row.click();
}, name);
const createProject = async (name, mode, path) => {
  await answerSaveWith(path);
  await click("New Project");
  await page.type("input[type=text]", name);
  await page.evaluate((mode) => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith(mode)).click(), mode);
  await click("Create Project…");
  await waitText("Scene Tree");
};
const closeProject = async () => { await menu("Project"); await click("Close Project"); await waitText("New Project"); };
const exportRom = async () => { await menu("Project"); await click("Export ROM..."); };
const isNdsRom = (path) => {
  if (!existsSync(path)) return false;
  const bytes = readFileSync(path);
  // An .nds header: a 12-byte game title ("HOMEBREW" from ndstool), then the ARM9 code offset at 0x20 (0x4000).
  return bytes.length > 100 * 1024 && bytes.subarray(0, 8).toString() === "HOMEBREW" && bytes.readUInt32LE(0x20) === 0x4000;
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
  await installDialog();
  await waitText("New Project");

  // ---- A blank 3D project: no camera, so exporting is an error, and nothing is asked or built.
  const projectPath = `${work}/spinner.gsds`;
  await createProject("Spinner", "3D", projectPath);
  const callsAfterCreate = (await saveCalls()).length;

  await menu("Project");
  const projectItems = await buttonLabels();
  const iSave = projectItems.indexOf("Save Project As...");
  const iExport = projectItems.indexOf("Export ROM...");
  const iClose = projectItems.indexOf("Close Project");
  assert.ok(iExport > iSave && iExport < iClose, `Export ROM... sits after the Save entries and before Close (${projectItems})`);
  await click("Project"); // close the menu
  await menu("Scene");
  assert.ok(!(await buttonLabels()).some((l) => l.includes("Export")), "the Scene menu has no Export entry");
  await click("Scene");
  pass("Export ROM... is in the Project menu, between Save and Close, and not in the Scene menu");

  await exportRom();
  await waitText("Error: ");
  assert.match(await body(), /no ROM was built/);
  assert.equal((await saveCalls()).length, callsAfterCreate, "no location was asked for");
  pass("a project with a compile error is reported in the Output log, without asking where to save");

  // ---- Build a real scene: cube + camera + light, saved.
  await addNode("MeshInstance3D");
  await selectRow("Main");
  await addNode("Camera3D");
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  await menu("Project");
  await click("Save Project");
  await waitText("Saved project to");
  const savedBytes = readFileSync(projectPath, "utf8");
  const savedMtime = statSync(projectPath).mtimeMs;

  // ---- Cancelling does nothing.
  const romA = `${work}/spinner-a.nds`;
  await answerSaveWith(null);
  const logBefore = await body();
  await exportRom();
  await sleep(1500);
  assert.equal((await saveCalls()).at(-1).title, "Export ROM", "the export asked for a location");
  assert.ok(!existsSync(romA));
  assert.ok(!(await body()).includes("Exported ROM"), "nothing was reported");
  assert.equal((await body()).length, logBefore.length, "cancelling changed nothing on screen");
  pass("cancelling the dialog builds nothing and logs nothing");

  // ---- Exporting the saved project writes a real ROM; the dialog started next to the project file.
  await answerSaveWith(romA);
  await exportRom();
  await waitText("Exported ROM to", 60000);
  assert.ok(isNdsRom(romA), "a .nds was written");
  assert.match((await saveCalls()).at(-1).defaultPath.replace(/\\/g, "/"), /\/spinner\.gsds$|\/Spinner\.nds$/i);
  assert.ok((await saveCalls()).at(-1).defaultPath.replace(/\\/g, "/").startsWith(work), "the dialog started in the project's folder");
  pass("exporting writes a valid .nds and says where, starting the dialog next to the project file");

  // ---- Unsaved edits are included; nothing is saved.
  await selectRow("Main");
  await addNode("MeshInstance3D"); // unsaved
  await waitText("Unsaved changes");
  const romB = `${work}/spinner-b.nds`;
  await answerSaveWith(romB);
  await exportRom();
  // While it builds: the menu says so, and can't start a second export.
  await menu("Project");
  const during = await buttonLabels();
  const busy = during.includes("Exporting ROM...");
  if (busy) {
    const disabled = await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Exporting ROM...").disabled);
    assert.ok(disabled, "the export entry is disabled while a build runs");
    pass("while a build runs, the menu shows 'Exporting ROM...' and the entry is disabled (a second export can't start)");
  } else {
    console.log("[NOTE] the build finished before the menu could be inspected; the busy state wasn't observed this run");
  }
  await click("Project"); // close the menu
  await page.waitForFunction(() => (document.body.innerText.match(/Exported ROM to/g) || []).length >= 2, { timeout: 60000 });
  assert.ok(isNdsRom(romB), "the second ROM was written");
  assert.notDeepEqual(readFileSync(romA), readFileSync(romB), "the ROM reflects the unsaved node");
  assert.equal(readFileSync(projectPath, "utf8"), savedBytes, "the project file on disk is unchanged");
  assert.equal(statSync(projectPath).mtimeMs, savedMtime, "the project file wasn't even rewritten");
  assert.ok((await body()).includes("Unsaved changes"), "the project still shows unsaved changes");
  pass("unsaved edits are in the ROM, the project file is untouched, and it still shows as unsaved");

  // The menu is usable again afterwards (allow a moment for the last render).
  await menu("Project");
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Export ROM..." && !b.disabled), { timeout: 5000 });
  await click("Project");
  pass("the export entry returns to normal once the build finishes");

  await page.screenshot({ path: join(HERE, "export-rom-done.png") });

  // ---- A 2D project says so.
  await menu("Project");
  await click("Save Project");
  await waitText("Saved project to");
  await closeProject();
  const calls2d = (await saveCalls()).length;
  await createProject("Flat", "2D", `${work}/flat.gsds`);
  const callsAfter2dCreate = (await saveCalls()).length;
  assert.equal(callsAfter2dCreate, calls2d + 1);
  await exportRom();
  await waitText("2D compilation isn't supported yet");
  assert.equal((await saveCalls()).length, callsAfter2dCreate, "no location was asked for");
  pass("a 2D project reports that 2D export isn't supported yet");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "export-rom-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
