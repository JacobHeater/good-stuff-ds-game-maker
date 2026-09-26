// Prototype E2E for sprites on the 2D screen of a 3D project (requirements/scene-designer/STORY.sprites-on-the-2d-screen-of-a-3d-project.md). Drives the built
// Electron app over CDP with real clicks, stubbing only the native file dialogs: a 3D project (3D on the top screen, 2D on the bottom), a Sprite2D imported onto its
// 2D screen and drawn by the 2D viewport, the Hardware tab's texture limit dropping to 384 KB (one bank goes to the sprite tiles), and a real Export ROM with no
// warning about the sprite. The emulator test (sprites-3d.rom.test.ts) checks what the ROM draws.
//
//   pnpm build && node tests/prototypes/e2e/sprites-3d-project.mjs
//
// Needs tools/ds-toolchain for the export. Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-sprite3d-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/sprites3d.gsds`;
const ROM_PATH = `${work}/sprites3d.nds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

// A 32 x 32 picture: four colored quadrants inside a transparent border.
{
  const png = new PNG({ width: 32, height: 32 });
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const clear = x < 4 || y < 4 || x >= 28 || y >= 28;
      png.data.set(clear ? [0, 0, 0, 0] : y < 16 ? (x < 16 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : x < 16 ? [0, 0, 255, 255] : [255, 255, 0, 255], (y * 32 + x) * 4);
    }
  }
  writeFileSync(`${work}/hero.png`, PNG.sync.write(png));
}

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
const click = (label, { endsWith = false } = {}) => page.evaluate((label, endsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith);
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(150);
};
const bottomTab = async (name) => { await click(name); await sleep(150); };
const setScreenFilter = async (value) => {
  await page.evaluate((value) => {
    const select = [...document.querySelectorAll("select")].find((s) => s.getAttribute("aria-label") === "Screen");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await sleep(250);
};
const drawnSprites = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=sprite-image]")].map((el) => {
  const box = el.getBoundingClientRect();
  return { width: Math.round(box.width), height: Math.round(box.height) };
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
  await answerSave(PROJECT_PATH);
  await click("New Project");
  await page.type("input[type=text]", "Sprites3D");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- A 3D scene to draw (a camera and a cube), then a sprite on the 2D screen.
  await addNode("Camera3D");
  await selectRow("Main");
  await addNode("MeshInstance3D");
  await selectRow("Main");
  await addNode("Sprite2D");
  await bottomTab("Hardware");
  const before = await body();
  assert.match(before, /Textures in scene\s*0 \/ 524288 bytes/, "with no sprite picture the textures have all 512 KB");
  await answerOpen(`${work}/hero.png`);
  await bottomTab("Output");
  await click("Import PNG...");
  await sleep(600);
  assert.match(await body(), /Imported sprite image "hero" \(32 x 32, 1024 bytes of sprite memory\) onto "Sprite2D"\./);
  pass("a Sprite2D on the 2D screen of a 3D project takes a PNG like it does in a 2D project");

  // ---- The 2D screen of the 3D project shows it (the toolbar's Screen select is on the 3D screen to begin with).
  await setScreenFilter("bottom");
  assert.deepEqual(await drawnSprites(), [{ width: 64, height: 64 }], "32 DS pixels drawn at 2 screen pixels each");
  pass("the 2D viewport of the 3D project draws the sprite's picture");

  // ---- One VRAM bank now holds the sprite tiles: the Hardware tab's texture limit drops to 384 KB, and the sprite memory is counted on the 2D screen.
  await bottomTab("Hardware");
  const after = await body();
  assert.match(after, /Textures in scene\s*0 \/ 393216 bytes/, "textures keep three banks: 384 KB");
  assert.match(after, /BOTTOM SCREEN\s*1 \/ 128\s*Sprite memory\s*1024 \/ 131072 bytes\s*Sprite palettes\s*1 \/ 16/i);
  pass("the Hardware tab shows the sprite on the 2D screen and the texture limit dropped to 384 KB");

  // ---- Export a real ROM: the sprite is built, not reported as unbuilt.
  await bottomTab("Output");
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 90000);
  const log = await body();
  assert.doesNotMatch(log, /Warning \[Sprite2D\]/, "no warning about the sprite");
  assert.equal(readFileSync(ROM_PATH).subarray(0, 8).toString(), "HOMEBREW");
  pass("Export ROM builds the 3D project with its sprite, with no warning about the sprite");
  console.log(`\nSaved project: ${PROJECT_PATH}`);

  // ---- Save: the project file holds the image and the sprite names it.
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
  const saved = JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
  assert.equal(saved.sprites.length, 1);
  assert.equal(saved.mode, "3D");
  assert.ok(saved.scene.children.some((n) => n.kind === "Sprite2D" && n.spriteId === saved.sprites[0].id));
  pass("the project file keeps the sprite image and the sprite that uses it");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "sprites-3d-project-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
