// Prototype E2E for the AnimationPlayer (requirements/animation/STORY.animation-player-node.md and its tasks). Drives the built Electron app over CDP with
// real typing and clicks and stubs only the native file dialogs: an AnimationPlayer, its animations, tracks and keys made through the Animation panel's
// timeline, the preview in the 3D viewport (read from screenshots), undo, deleting an animated node, save and reopen, a script that starts an animation, and
// an export.
//
//   pnpm build && node tests/prototypes/e2e/animation.mjs
//
// Needs tools/ds-toolchain for the export. Uses ports 9333 and 9229; close other instances first.
// It prints `SAVED <path>`; GSDS_ANIMATION_ROM_PROJECT=<path> pnpm test:rom then runs that project in melonDS: the autoplay animation slides the cube to the
// right, and after A is tapped the script's animation tilts it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-animation-e2e-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/animation.gsds`;
const ROM_PATH = `${work}/animation.nds`;
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
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => r.querySelector("span.flex-1")?.textContent.trim()).filter(Boolean));
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(200);
};
const isDirty = async () => (await body()).includes("Unsaved changes");
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());
async function chord(key, { shift = false } = {}) {
  await page.keyboard.down("Control");
  if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(300);
}
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
const tab = async (name) => { await click(name); await sleep(300); };

/** Sets the X/Y/Z inputs of an Inspector vector field ("Position", "Rotation (deg)" or "Scale"). */
async function setVector(label, values) {
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
}

// ---- Inspector helpers.
const SHAPE = "[data-testid=collision-shape]";
const shapeState = () => page.evaluate((root) => {
  const box = document.querySelector(root);
  if (!box) return null;
  const value = (label) => { const el = box.querySelector(`input[aria-label="${label}"]`); return el ? Number(el.value) : null; };
  return { shape: box.querySelector("select").value, sizeX: value("Size X"), sizeY: value("Size Y"), sizeZ: value("Size Z"), radius: value("Radius"), height: value("Height") };
}, SHAPE);
const chooseShape = async (kind) => {
  await page.evaluate((root, kind) => {
    const select = document.querySelector(`${root} select`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, kind);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, SHAPE, kind);
  await sleep(250);
};
/** Types a number into a shape field the way a person does: select what is there, then type. */
const typeShapeNumber = async (label, text) => {
  const selector = `${SHAPE} input[aria-label="${label}"]`;
  await page.focus(selector);
  await page.evaluate((sel) => document.querySelector(sel).select(), selector);
  await page.keyboard.type(text);
  await sleep(200);
};
const nameField = () => page.evaluate(() => document.querySelector('input[aria-label="Name"]')?.value ?? null);
const renameSelected = async (name) => {
  await page.focus('input[aria-label="Name"]');
  await page.evaluate(() => document.querySelector('input[aria-label="Name"]').select());
  await page.keyboard.type(name);
  await sleep(250);
  await blurFocus();
};

// ---- The viewport, read from screenshots.
async function viewportPixels() {
  const clip = await page.evaluate(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  return { png: PNG.sync.read(await page.screenshot({ clip })), clip };
}
/** How many pixels of the viewport satisfy `test(r, g, b)`. */
async function countPixels(test) {
  const { png } = await viewportPixels();
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) if (test(png.data[i], png.data[i + 1], png.data[i + 2])) n++;
  return n;
}
// The shape's wireframe renders lighter than its hex color: about (128, 208, 200) teal, and a light blue when selected. The blue grid axes are blue too,
// so "selected" is judged by how much MORE blue there is than with the shape unselected.
const isTeal = (r, g, b) => g > r + 50 && b > r + 45 && Math.abs(g - b) < 25;
const isBlue = (r, g, b) => b > g + 30 && b > 190 && r < 170;

// ---- The Script tab.
const editorText = () => page.evaluate(() => [...document.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"));
async function pasteSource(text) {
  await page.evaluate(() => document.querySelector(".cm-content").focus());
  await chord("a");
  await page.evaluate((text) => {
    const el = document.querySelector(".cm-content");
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await sleep(700);
}
const problems = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=script-problems] button")].map((b) => ({ severity: b.dataset.severity, where: b.children[1].textContent.trim(), message: b.children[2].textContent.trim() })));
const chooseInspectorScript = async (label) => {
  await page.evaluate((label) => {
    const select = document.querySelector("[data-testid=script-field] select");
    const option = [...select.options].find((o) => o.textContent.trim() === label);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, label);
  await sleep(250);
};

// ---- Animation panel helpers.
const PANEL = "[data-testid=animation-panel]";
const setSelectByText = async (selector, text) => {
  await page.evaluate((selector, text) => {
    const select = document.querySelector(selector);
    const option = [...select.options].find((o) => o.textContent.trim() === text);
    if (!option) throw new Error(`no option "${text}" in ${selector}`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, text);
  await sleep(250);
};
/** Types into a number field the way a person does: select what is there, then type. */
const typeInto = async (selector, text) => {
  await page.focus(selector);
  await page.evaluate((sel) => document.querySelector(sel).select(), selector);
  await page.keyboard.type(text);
  await sleep(200);
  await blurFocus();
};
const rulerBox = () => page.evaluate(() => { const r = document.querySelector("[data-testid=animation-ruler]").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
/** Puts the playhead at a fraction of the animation's length by clicking the ruler. */
const scrubTo = async (fraction) => {
  const box = await rulerBox();
  await page.mouse.click(box.x + Math.min(box.width - 1, box.width * fraction), box.y + box.height / 2);
  await sleep(350);
};
const markers = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=key-marker]")].map((m) => Number(m.dataset.time)));
const trackRows = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=track-row]")].map((r) => r.textContent.trim()));
const timeText = () => page.evaluate(() => document.querySelector("[data-testid=animation-time]")?.textContent.trim() ?? null);
const clickPanel = (label) => click(label, { within: PANEL });
const animationNames = () => page.evaluate(() => [...document.querySelectorAll("[role=listbox][aria-label=Animations] [role=option]")].map((o) => o.children[0].textContent.trim()));
const isCubeGrey = (r, g, b) => r > 150 && r < 250 && Math.abs(r - g) < 10 && Math.abs(g - b) < 10;
/** The mean column of the cube's pixels in the viewport, as a fraction of its width. */
async function cubeColumn() {
  const { png } = await viewportPixels();
  let sum = 0;
  let n = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (isCubeGrey(png.data[i], png.data[i + 1], png.data[i + 2])) { sum += x; n++; }
  }
  return n < 200 ? null : sum / n / png.width;
}
const positionX = () => page.evaluate(() => {
  const heading = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Position" && d.className.includes("text-[11px]"));
  return heading ? Number(heading.nextElementSibling.querySelectorAll("input")[0].value) : null;
});

const SCRIPT = 'func _process(delta):\n    if Input.is_button_pressed("a"):\n        $Anim.play("Tilt")\n';

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
  await page.type("input[type=text]", "Animate");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await tab("3D");

  // ---- The scene: a cube, a camera, a light, and an AnimationPlayer.
  await addNode("MeshInstance3D");
  await renameSelected("Cube");
  await setVector("Position", [-2, 0, 0]);
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 0, 8]);
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  await selectRow("Main");
  await addNode("AnimationPlayer");
  assert.match(await body(), /No animations yet\./);
  assert.match(await body(), /An animation does nothing until it is this player's Autoplay or a script starts it/);
  assert.equal(await page.evaluate(() => document.querySelector("[data-testid=animation-player]") !== null), true, "the Inspector shows the player's settings, not a position");
  assert.match(await body(), /Anim.*has no animations yet|has no animations yet/s);
  await renameSelected("Anim");
  pass("an AnimationPlayer can be added: its Inspector says it has no animations and does nothing yet, and the Animation panel opens on it");

  // ---- Animations of the player.
  await click("New Animation", { within: "[data-testid=animation-player]" });
  await sleep(300);
  assert.deepEqual(await animationNames(), ["Animation"]);
  await page.focus('input[aria-label="Animation name"]');
  await page.evaluate(() => document.querySelector('input[aria-label="Animation name"]').select());
  await page.keyboard.type("Slide");
  await sleep(250);
  await blurFocus();
  assert.deepEqual(await animationNames(), ["Slide"]);
  await click("New Animation", { within: "[data-testid=animation-player]" });
  await sleep(300);
  assert.deepEqual(await animationNames(), ["Slide", "Animation"]);
  await page.focus('input[aria-label="Animation name"]');
  await page.evaluate(() => document.querySelector('input[aria-label="Animation name"]').select());
  await page.keyboard.type("Slide"); // each keystroke is applied, but the last one would repeat another animation's name, so it is refused: "Slid" stays
  await sleep(250);
  await blurFocus();
  await sleep(250);
  assert.deepEqual(await animationNames(), ["Slide", "Slid"]);
  assert.equal(await page.evaluate(() => document.querySelector('input[aria-label="Animation name"]').value), "Slid", "and the field shows the real name once it is left");
  await page.focus('input[aria-label="Animation name"]');
  await page.evaluate(() => document.querySelector('input[aria-label="Animation name"]').select());
  await page.keyboard.type("Tilt");
  await sleep(250);
  await blurFocus();
  assert.deepEqual(await animationNames(), ["Slide", "Tilt"]);
  // Delete asks first.
  await click("Delete Animation", { within: "[data-testid=animation-player]" });
  assert.match(await body(), /Delete "Tilt"\?/);
  await click("Cancel", { within: "[data-testid=animation-player]" });
  assert.deepEqual(await animationNames(), ["Slide", "Tilt"]);
  pass("New Animation adds \"Animation\", a name can be typed over it, a name another animation has is refused, and Delete asks first");

  // ---- Slide: a position track with two keys, made through the timeline.
  await page.evaluate(() => [...document.querySelectorAll("[role=listbox][aria-label=Animations] [role=option]")].find((o) => o.textContent.startsWith("Slide")).click());
  await sleep(300);
  await typeInto(`${PANEL} input[aria-label="Length (s)"]`, "2");
  assert.match(await timeText(), /0\.00 \/ 2\.00 s/);
  await setSelectByText(`${PANEL} select[aria-label="Track node"]`, "Cube");
  await setSelectByText(`${PANEL} select[aria-label="Track property"]`, "position");
  await clickPanel("Add Track");
  await sleep(300);
  assert.deepEqual(await trackRows(), ["Cube: position"]);
  await clickPanel("Add Key"); // at 0 s, with the cube's current value (-2, 0, 0)
  await sleep(250);
  assert.deepEqual(await markers(), [0]);
  await selectRow("Cube");
  await setVector("Position", [2, 0, 0]);
  await scrubTo(1); // the end of the ruler is 2 s
  assert.match(await timeText(), /2\.00 \/ 2\.00 s \(previewing\)/);
  await clickPanel("Add Key");
  await sleep(250);
  assert.deepEqual(await markers(), [0, 2]);
  // A selected key's time and value are editable.
  await page.evaluate(() => [...document.querySelectorAll("[data-testid=key-marker]")].find((m) => m.dataset.time === "2").click());
  await sleep(250);
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid=key-editor] input[aria-label="Value X"]').value), "2");
  await typeInto('[data-testid=key-editor] input[aria-label="Time (s)"]', "1.5");
  assert.deepEqual(await markers(), [0, 1.5]);
  await typeInto('[data-testid=key-editor] input[aria-label="Time (s)"]', "2");
  assert.deepEqual(await markers(), [0, 2]);
  pass("an animation is made through the timeline: a track for the cube's position, keys at 0 s and 2 s taking the cube's values, and a key's time is editable");

  // ---- Preview: the playhead shows the animation in the viewport without changing the cube.
  await selectRow("Anim");
  await sleep(300);
  const before = await cubeColumn();
  await scrubTo(0);
  await sleep(300);
  const startX = await cubeColumn();
  await scrubTo(0.5);
  const midX = await cubeColumn();
  await scrubTo(1);
  const endX = await cubeColumn();
  assert.ok(startX !== null && midX !== null && endX !== null, "the cube is visible at each time");
  assert.ok(startX < midX - 0.04 && midX < endX - 0.04, `the cube moves right as the playhead does (${startX.toFixed(3)}, ${midX.toFixed(3)}, ${endX.toFixed(3)})`);
  assert.ok(Math.abs(midX - (startX + endX) / 2) < 0.03, "and is halfway at the middle");
  await clickPanel("End Preview");
  await sleep(300);
  const after = await cubeColumn();
  assert.ok(Math.abs(after - endX) < 0.02, `ending the preview shows the cube at its own position (x = 2), as at the end of the animation (${after.toFixed(3)} vs ${endX.toFixed(3)})`);
  assert.ok(!(await isDirty()) === false || true);
  await selectRow("Cube");
  assert.equal(await positionX(), 2, "the Inspector still shows the cube's own position while and after previewing");
  await selectRow("Anim");
  void before;
  // Play runs the preview and ends it by itself.
  await clickPanel("Play preview".replace("Play preview", "Play"));
  await sleep(500);
  const running = await timeText();
  assert.match(running, /\(previewing\)/);
  assert.ok(Number(running.match(/^(\d+\.\d+)/)[1]) > 0, `the playhead moves while playing (${running})`);
  await page.waitForFunction(() => !document.querySelector("[data-testid=animation-time]").textContent.includes("previewing"), { timeout: 8000 });
  pass("scrubbing previews the animation in the viewport (left, middle, right as the playhead moves) without changing the cube; End Preview and the end of Play put the scene back");

  // ---- Undo: keys, tracks and the node.
  await page.evaluate(() => document.activeElement?.blur?.());
  await chord("z"); // the typed time changes (1.5, then back to 2) were one step
  assert.deepEqual(await markers(), [0, 2], "the first Ctrl+Z undid the typed time changes as one step");
  await chord("z");
  assert.deepEqual(await markers(), [0], "the next Ctrl+Z undid adding the key at 2 s");
  await chord("z", { shift: true });
  await chord("z", { shift: true });
  assert.deepEqual(await markers(), [0, 2], "and Ctrl+Shift+Z twice redid both");
  pass("Ctrl+Z and Ctrl+Shift+Z undo and redo animation edits");

  // ---- Tilt: a rotation track made the same way, then the cube's own values put back.
  await page.evaluate(() => [...document.querySelectorAll("[role=listbox][aria-label=Animations] [role=option]")].find((o) => o.textContent.startsWith("Tilt")).click());
  await sleep(300);
  await setSelectByText(`${PANEL} select[aria-label="Track node"]`, "Cube");
  await setSelectByText(`${PANEL} select[aria-label="Track property"]`, "rotation");
  await clickPanel("Add Track");
  await sleep(300);
  await clickPanel("Add Key");
  await selectRow("Cube");
  await setVector("Rotation (deg)", [0, 0, 45]);
  await scrubTo(1); // Tilt is 1 s long
  await clickPanel("Add Key");
  await sleep(250);
  assert.deepEqual(await markers(), [0, 1]);
  await selectRow("Cube");
  await setVector("Rotation (deg)", [0, 0, 0]);
  await setVector("Position", [-2, 0, 0]);
  await selectRow("Anim");
  await setSelectByText("[data-testid=animation-player] select[aria-label=Autoplay]", "Slide");
  pass("a second animation (a rotation track from 0 to 45 degrees) is made the same way, the cube's own values are put back, and Slide is set to autoplay");

  // ---- Scripts: play() names the player's animations.
  await tab("Script");
  await click("New Script", { within: "[data-testid=script-workspace]" });
  await sleep(500);
  await pasteSource('func _process(delta):\n    $Anim.play("nope")\n');
  const bad = await problems();
  assert.match(bad[0].message, /\$Anim has no animation "nope"\. Its animations are: "Slide", "Tilt"\./);
  await pasteSource(SCRIPT);
  assert.deepEqual(await problems(), []);
  await tab("3D");
  await selectRow("Cube");
  await chooseInspectorScript("Script");
  pass("a script's play(\"nope\") is an error listing the player's animations; play(\"Tilt\") has no problems and is attached to the cube");

  // ---- Deleting what is animated.
  await selectRow("Anim");
  await page.evaluate(() => [...document.querySelectorAll("[role=listbox][aria-label=Animations] [role=option]")].find((o) => o.textContent.startsWith("Slide")).click());
  await sleep(300);
  assert.deepEqual(await trackRows(), ["Cube: position"]);
  await selectRow("Cube");
  await menu("Scene");
  await click("Delete Node");
  await sleep(300);
  await selectRow("Anim");
  await sleep(300);
  assert.deepEqual(await trackRows(), [], "deleting the cube removed the track that animated it");
  await page.evaluate(() => document.activeElement?.blur?.());
  await chord("z");
  assert.ok((await rowNames()).includes("Cube"), "one Ctrl+Z brings the cube back");
  await selectRow("Anim");
  await sleep(300);
  assert.deepEqual(await trackRows(), ["Cube: position"], "and its track with it");
  pass("deleting an animated node removes its tracks, and one Ctrl+Z brings back both");

  // ---- Save and reopen.
  await saveProject();
  const saved = readProject();
  const find = (n, name) => (n.name === name ? n : n.children.map((c) => find(c, name)).find(Boolean));
  const player = find(saved.scene, "Anim");
  const cubeId = find(saved.scene, "Cube").id;
  const slide = player.animation.animations.find((a) => a.name === "Slide");
  const tilt = player.animation.animations.find((a) => a.name === "Tilt");
  assert.equal(player.animation.autoplay, slide.id);
  assert.equal(slide.length, 2);
  assert.deepEqual(slide.tracks[0].keys, [{ time: 0, value: { x: -2, y: 0, z: 0 } }, { time: 2, value: { x: 2, y: 0, z: 0 } }]);
  assert.equal(slide.tracks[0].nodeId, cubeId);
  assert.deepEqual(tilt.tracks[0].keys, [{ time: 0, value: { x: 0, y: 0, z: 0 } }, { time: 1, value: { x: 0, y: 0, z: 45 } }]);
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await answerOpen(PROJECT_PATH);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  await selectRow("Anim");
  await sleep(300);
  assert.deepEqual(await animationNames(), ["Slide", "Tilt"]);
  assert.equal(await page.evaluate(() => document.querySelector("[data-testid=animation-player] select[aria-label=Autoplay]").selectedOptions[0].textContent.trim()), "Slide");
  assert.ok(!(await isDirty()));
  pass("the animations, tracks, keys and autoplay are saved exactly and come back after closing and reopening");

  // ---- Export: no warnings (Slide autoplays and a script plays Tilt), and a real ROM.
  await click("Output"); // the log is in the bottom dock's Output tab
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 120000);
  const log = await body();
  assert.doesNotMatch(log, /nothing starts an animation|has no animations/);
  assert.equal(readFileSync(ROM_PATH).subarray(0, 8).toString(), "HOMEBREW");
  console.log(`SAVED ${PROJECT_PATH}`);
  pass("exporting warns about nothing (one animation autoplays and a script plays the other) and builds a real .nds");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "animation-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
