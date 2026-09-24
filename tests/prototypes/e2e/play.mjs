// Prototype E2E for the toolbar's "Play" (requirements/run-games-locally/STORY.play-runs-rom-in-emulator.md).
// Drives the built Electron app over CDP and lets the REAL compiler, toolchain and melonDS run. Nothing is
// stubbed except the native save dialog used to create the project. Needs tools/ds-toolchain set up.
//
//   pnpm build && node tests/prototypes/e2e/play.mjs
//
// It opens melonDS windows and kills any melonDS.exe first and last. Uses ports 9333 and 9229.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-play-")).replace(/\\/g, "/");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

/** Running melonDS processes: [{ pid, rom }], from their command lines. */
function emulators() {
  const out = execFileSync("powershell", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='melonDS.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], { encoding: "utf8" });
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [pid, ...rest] = line.split("|");
    const match = /"([^"]+\.nds)"|(\S+\.nds)/i.exec(rest.join("|"));
    return { pid: Number(pid), rom: (match?.[1] ?? match?.[2] ?? "").replace(/\\/g, "/") };
  });
}
const killEmulators = () => { try { execFileSync("taskkill", ["/F", "/IM", "melonDS.exe"], { stdio: "ignore" }); } catch {} };
async function waitForEmulators(predicate, what, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const list = emulators();
    if (predicate(list)) return list;
    await sleep(300);
  }
  throw new Error(`timed out waiting for: ${what} (running: ${JSON.stringify(emulators())})`);
}

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

let app;
let page;
async function startApp(extraEnv = {}, name) {
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  app = spawn(`${DESKTOP}/node_modules/electron/dist/electron.exe`, [".", "--remote-debugging-port=9333", "--inspect=9229", `--user-data-dir=${work}/userdata-${name}`], { cwd: DESKTOP, env, stdio: "ignore" });
  await waitFor("http://127.0.0.1:9333/json/version");
  await waitFor("http://127.0.0.1:9229/json");
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null });
  page = undefined;
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes("index.html"));
    if (!page) await sleep(500);
  }
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });
  await mainEval(`(() => {
    const req = (process.mainModule && process.mainModule.require) || require;
    const { dialog } = req("electron");
    globalThis.__save = null;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__save });
    return "ok";
  })()`);
  await waitText("New Project");
}
async function stopApp() {
  try { app.kill(); } catch {}
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
  await sleep(1500);
}

const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const count = async (text) => ((await body()).match(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const selectRow = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
  if (!row) throw new Error(`no scene tree row "${name}"`);
  row.click();
}, name);
async function setVector(label, [x, y, z]) {
  await page.evaluate((label, values) => {
    const heading = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === label && d.className.includes("text-[11px]"));
    if (!heading) throw new Error(`no Inspector field "${label}"`);
    const inputs = [...heading.nextElementSibling.querySelectorAll("input")];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    inputs.forEach((input, i) => { setter.call(input, String(values[i])); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }, label, [x, y, z]);
  await sleep(120);
}
const createProject = async (name, mode, path) => {
  await mainEval(`globalThis.__save = ${JSON.stringify(path)}`);
  await click("New Project");
  await page.type("input[type=text]", name);
  await page.evaluate((mode) => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith(mode)).click(), mode);
  await click("Create Project…");
  await waitText("Scene Tree");
};
const playButton = () => page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Play") || x.textContent.trim() === "Building...");
  return { text: b.textContent.trim(), disabled: b.disabled };
});
const isNdsRom = (path) => existsSync(path) && readFileSync(path).subarray(0, 8).toString() === "HOMEBREW";

killEmulators();
try {
  // =============== With an emulator installed ===============
  await startApp({}, "main");
  const projectPath = `${work}/runner.gsds`;
  await createProject("Runner", "3D", projectPath);

  // ---- A project that can't compile launches nothing.
  await click("▶ Play");
  await waitText("Play stopped: the project has errors");
  assert.match(await body(), /Error: .*[Cc]amera/);
  await sleep(1000);
  assert.equal(emulators().length, 0, "no emulator was started");
  assert.ok(!(await body()).includes("Play pressed (no backend"), "the old stub message is gone");
  pass("a project that can't compile logs why and starts no emulator");

  // ---- Build a real scene (camera pulled back so the cube is visible), save it.
  await addNode("MeshInstance3D");
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 0, 6]);
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  await setVector("Rotation (deg)", [-50, 30, 0]);
  await menu("Project");
  await click("Save Project");
  await waitText("Saved project to");
  const savedBytes = readFileSync(projectPath, "utf8");
  const savedMtime = statSync(projectPath).mtimeMs;

  // ---- Play builds and opens the emulator with a real ROM.
  await click("▶ Play");
  const busy = await playButton();
  const first = await waitForEmulators((l) => l.length === 1, "one emulator");
  await waitText("Running in melonDS");
  assert.ok(isNdsRom(first[0].rom), `the emulator was opened with a real .nds (${first[0].rom})`);
  assert.ok(first[0].rom.includes("gsds-play"), "the ROM is in a temp folder, not next to the project");
  if (busy.text === "Building...") assert.ok(busy.disabled, "Play is disabled while building");
  pass("Play builds the project and opens melonDS with the ROM");
  await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Play")); return b && !b.disabled; }, { timeout: 5000 });

  // ---- Unsaved edits are what runs; a new Play replaces the old run.
  await selectRow("Main");
  await addNode("MeshInstance3D"); // unsaved
  await waitText("Unsaved changes");
  const firstRom = readFileSync(first[0].rom);
  await click("▶ Play");
  const second = await waitForEmulators((l) => l.length === 1 && l[0].pid !== first[0].pid, "the old emulator replaced by a new one");
  await waitText("Running in melonDS");
  assert.notEqual(second[0].rom, first[0].rom, "the new run uses the new ROM");
  assert.notDeepEqual(readFileSync(second[0].rom), firstRom, "the running ROM reflects the unsaved node");
  assert.ok(!existsSync(first[0].rom), "the replaced run's ROM was cleaned up");
  assert.equal(readFileSync(projectPath, "utf8"), savedBytes, "the project file is unchanged");
  assert.equal(statSync(projectPath).mtimeMs, savedMtime, "the project file wasn't rewritten");
  assert.ok((await body()).includes("Unsaved changes"), "the project still shows unsaved changes");
  pass("unsaved edits are what runs, the project file is untouched, and Play replaces the previous emulator");

  // ---- The editor stays usable while the emulator runs; the user closing the emulator is fine.
  await addNode("Node3D");
  await sleep(200);
  assert.equal(emulators().length, 1);
  killEmulators();
  await sleep(800);
  await click("▶ Play");
  await waitForEmulators((l) => l.length === 1, "Play works after the user closed the emulator");
  pass("the editor is usable while the game runs, and Play works again after the user closes the emulator");

  // ---- Quitting the editor closes the game.
  await mainEval(`(() => { const req = (process.mainModule && process.mainModule.require) || require; req("electron").app.emit("before-quit"); return "ok"; })()`);
  await waitForEmulators((l) => l.length === 0, "the game closed with the editor");
  pass("quitting the editor closes the running game");
  await stopApp();

  // =============== With no emulator ===============
  const missing = `${work}/no-such-melonDS.exe`;
  await startApp({ GSDS_MELONDS_PATH: missing }, "missing");
  await createProject("Runner2", "3D", `${work}/runner2.gsds`);
  await addNode("MeshInstance3D");
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 0, 6]);
  await click("▶ Play");
  await waitText("GSDS_MELONDS_PATH is set to");
  const log = await body();
  const romMatch = /you can open it in an emulator yourself/.test(log) && /"([^"]+\.nds)"/.exec(log);
  assert.ok(romMatch, "the message says where the built ROM is");
  assert.ok(isNdsRom(romMatch[1].replace(/\\/g, "/")), "and that ROM exists");
  assert.equal(emulators().length, 0);
  pass("a missing emulator is explained, and the built ROM is kept and named");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "play-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  await stopApp();
  killEmulators();
}
