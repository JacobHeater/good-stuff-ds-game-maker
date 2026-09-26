// Prototype E2E for animated sprites (requirements/scene-designer/STORY.animated-sprites.md). Drives the built Electron app over CDP and stubs only the native file dialogs.
// It writes a real sprite sheet PNG (four flat-colored 16 x 16 frames), imports it through the real Inspector into a 2D project's AnimatedSprite2D with the frame size chosen in the
// UI, reads the pixels the 2D viewport actually draws, edits animations (names, frames, speed, loop, start), sees a bad frame list refused, saves, reopens, and undoes.
//
//   pnpm build && node tests/prototypes/e2e/animated-sprite.mjs
//
// Uses ports 9333 and 9229; close other instances first.
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
const work = mkdtempSync(join(tmpdir(), "gsds-animsprite-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/animated.gsds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

// ---- Test images: a sheet of four 16 x 16 frames (red, green, blue, yellow), and one that isn't a whole number of 32 x 16 frames.
function writePng(path, width, height, pixel) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set(pixel(x, y), (y * width + x) * 4);
  writeFileSync(path, PNG.sync.write(png));
}
const COLORS = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]];
writePng(`${work}/run.png`, 64, 16, (x) => COLORS[Math.floor(x / 16)]);
writePng(`${work}/ragged.png`, 48, 16, () => [10, 20, 30, 255]);

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
  globalThis.__save = null; globalThis.__open = null; globalThis.__openCalls = [];
  dialog.showSaveDialog = async () => globalThis.__save ? { canceled: false, filePath: globalThis.__save } : { canceled: true };
  dialog.showOpenDialog = async (...args) => {
    const options = args[args.length - 1];
    globalThis.__openCalls.push({ title: options.title, filters: options.filters });
    return globalThis.__open ? { canceled: false, filePaths: [globalThis.__open] } : { canceled: true, filePaths: [] };
  };
  return "ok";
})()`);
const answerSave = (p) => mainEval(`globalThis.__save = ${JSON.stringify(p)}`);
const answerOpen = (p) => mainEval(`globalThis.__open = ${JSON.stringify(p)}`);
const openCalls = () => mainEval("globalThis.__openCalls");

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
const testId = (id) => `[data-testid="${id}"]`;
const exists = (id) => page.evaluate((id) => Boolean(document.querySelector(`[data-testid="${id}"]`)), id);
const valueOf = (id) => page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.value ?? null, id);
async function chooseInTestId(id, prefix) {
  await page.evaluate((id, prefix) => {
    const select = document.querySelector(`[data-testid="${id}"]`);
    const option = [...select.options].find((o) => o.textContent.trim().startsWith(prefix));
    if (!option) throw new Error(`no option starting with "${prefix}" in ${id}`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, id, prefix);
  await sleep(200);
}
async function setInspectorNumber(label, value) {
  await page.evaluate((label, value) => {
    const wrap = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === label);
    if (!wrap) throw new Error(`no Inspector field "${label}"`);
    const input = wrap.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, label, value);
  await sleep(150);
}
async function commitText(id, text) {
  await page.focus(testId(id));
  await page.$eval(testId(id), (el) => el.select());
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await sleep(250);
}
async function setNumber(id, value) {
  await page.evaluate((id, value) => {
    const input = document.querySelector(`[data-testid="${id}"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, id, value);
  await sleep(200);
}
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
async function chord(key) {
  await page.keyboard.down("Control");
  await page.keyboard.press(key);
  await page.keyboard.up("Control");
  await sleep(250);
}
/** The colors of the sprite element the 2D viewport draws, from a screenshot of it. */
async function viewportColor() {
  const el = await page.$("[data-testid=sprite-image]");
  const png = PNG.sync.read(Buffer.from(await el.screenshot({ encoding: "base64" }), "base64"));
  const i = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}
const near = ([r, g, b], [er, eg, eb], tolerance = 40) => Math.abs(r - er) <= tolerance && Math.abs(g - eg) <= tolerance && Math.abs(b - eb) <= tolerance;

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
  await page.type("input[type=text]", "Animated");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- An AnimatedSprite2D's Inspector has the sheet field and the animations list (empty); a Sprite2D has neither.
  await addNode("AnimatedSprite2D");
  await setInspectorNumber("Position X", 128);
  await setInspectorNumber("Position Y", 96);
  assert.ok(await exists("sprite-sheet-field"), "the sheet field is there");
  assert.ok(await exists("sprite-animations"), "the animations list is there");
  assert.ok((await body()).includes("No animations yet"));
  assert.equal(await exists("animation-start"), false, "no starting-animation choice with no animations");
  pass("an AnimatedSprite2D's Inspector has a sprite sheet field and an animations list (empty)");

  // ---- A sheet the frame size doesn't divide is refused, with a reason, and changes nothing.
  await click("Save Project").catch(() => {});
  await answerOpen(`${work}/ragged.png`);
  await chooseInTestId("frame-size", "32 x 16");
  await page.click(testId("import-sheet"));
  await sleep(500);
  const dialog = (await openCalls()).at(-1);
  assert.equal(dialog.title, "Import Sprite Sheet");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Output")?.click());
  await sleep(200);
  assert.ok((await body()).includes("isn't a whole number of 32 x 16 frames"), "the refusal is explained in the Output log");
  assert.ok((await body()).includes("No animations yet"), "nothing changed");
  pass("a sheet that isn't a whole number of frames is refused with a reason (a Sprite Sheet dialog), changing nothing");

  // ---- Importing a good sheet with 16 x 16 frames: it lands on the node with one animation that plays every frame from the start.
  await answerOpen(`${work}/run.png`);
  await chooseInTestId("frame-size", "16 x 16");
  await page.click(testId("import-sheet"));
  await sleep(600);
  assert.ok(await exists("sheet-preview"), "the sheet is shown");
  assert.ok((await body()).includes("4 frames of 16 x 16 (4 across, 1 down), 1024 bytes of sprite memory"));
  assert.equal(await valueOf("animation-name-0"), "default");
  assert.equal(await valueOf("animation-frames-0"), "0-3");
  assert.equal(await valueOf("animation-start"), "default");
  pass("importing a sheet with a 16 x 16 frame size gives four frames and a 'default' animation (0-3) that starts");

  // ---- The 2D viewport draws the frame the sprite starts on: frame 0, red. And it is one frame wide (16 DS pixels, drawn 2x), not the whole sheet.
  const box = await page.evaluate(() => { const r = document.querySelector("[data-testid=sprite-image]").getBoundingClientRect(); return { width: r.width, height: r.height }; });
  assert.deepEqual([box.width, box.height], [32, 32]);
  const first = await viewportColor();
  assert.ok(near(first, [255, 0, 0]), `frame 0 is red, but the viewport shows ${first}`);
  pass("the 2D viewport draws one frame (16 x 16, at 2x) of the sheet: the first frame of the starting animation, red");

  // ---- Add an animation: it takes a fresh name; edit its frames, speed and looping; the start can move to it, and the viewport follows.
  await page.click(testId("animation-add"));
  await sleep(250);
  assert.equal(await valueOf("animation-name-1"), "anim");
  await commitText("animation-name-1", "jump");
  assert.equal(await valueOf("animation-name-1"), "jump", `the name field says ${await valueOf("animation-name-1")}`);
  console.log("names:", await page.evaluate(() => [...document.querySelectorAll("[data-testid^=animation-name-]")].map((i) => i.value)));
  await commitText("animation-frames-1", "2, 3");
  await setNumber("animation-fps-1", 12);
  await page.click(testId("animation-loop-1"));
  await sleep(200);
  await chooseInTestId("animation-start", "jump");
  const second = await viewportColor();
  assert.ok(near(second, [0, 0, 255]), `the viewport shows frame 2 (blue), the first frame of jump, but shows ${second}`);
  pass("adds an animation, names it, gives it frames '2, 3', 12 a second, no loop, and starts with it: the viewport shows its first frame (blue)");

  // ---- A frame list the sheet can't have is refused where it is typed, and the animation keeps what it had.
  await commitText("animation-frames-1", "0-9");
  assert.ok((await body()).includes("Frame 9 isn't in the sheet, which has 4 frames"));
  await commitText("animation-frames-0", "0, x");
  assert.ok((await body()).includes('"x" isn\'t a frame number'));
  // a name another animation already has is refused too
  await commitText("animation-name-1", "default");
  assert.equal(await valueOf("animation-name-1"), "jump", "the name went back");
  pass("a bad frame list (past the sheet, or not a number) is refused with a message, and a name that is taken is put back");

  // ---- Preview plays the animation in the Inspector.
  await page.click(testId("animation-preview-toggle-0"));
  await sleep(300);
  assert.ok(await exists("animation-preview"), "the preview picture is shown");
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    seen.add(await page.evaluate(() => document.querySelector("[data-testid=animation-preview]")?.src));
    await sleep(100);
  }
  assert.ok(seen.size >= 2, "the preview changes frame by itself");
  await page.click(testId("animation-preview-toggle-0"));
  pass("the preview button plays an animation's frames in the Inspector (the picture changes by itself)");

  // ---- Saved: the sheet with its frame size and the animations, loading it back gives the same.
  await saveProject();
  let saved = readProject();
  const sheet = saved.sprites[0];
  assert.deepEqual([sheet.width, sheet.height, sheet.frameWidth, sheet.frameHeight], [64, 16, 16, 16]);
  const node = saved.scene.children[0];
  assert.equal(node.kind, "AnimatedSprite2D");
  assert.deepEqual(node.spriteAnimations, {
    animations: [
      { name: "default", frames: [0, 1, 2, 3], fps: 8, loop: true },
      { name: "jump", frames: [2, 3], fps: 12, loop: false }
    ],
    start: "jump"
  });
  pass("saving writes the sheet's frame size and the animations (names, frames, speeds, looping) and the start");

  // ---- Undo takes the last edits back one at a time (typing a value is one step).
  await chord("z");
  const undone = await page.evaluate(() => document.querySelector("[data-testid=animation-start]")?.value);
  assert.equal(undone, "default", "undo put the start back");
  await chord("y").catch(() => {});
  pass("undo puts the starting animation back");

  console.log(`\n${checks} checks passed`);
  console.log(`GSDS_ANIMATED_PROJECT=${PROJECT_PATH}`);
  await browser.disconnect();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  try {
    const pages = await (await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null })).pages();
    await pages.find((p) => p.url().includes("index.html"))?.screenshot({ path: join(HERE, "animated-sprite-failure.png") });
  } catch {}
} finally {
  app.kill();
}
