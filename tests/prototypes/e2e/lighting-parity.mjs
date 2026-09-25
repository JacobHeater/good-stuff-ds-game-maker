// Prototype E2E for the editor's lighting and the light intensity slider
// (requirements/scene-designer/BUG.editor-lighting-differs-from-rom.md, STORY.directional-light-intensity.md).
// It builds a flat grey plane and a directional light through the real UI, reads the brightness the 3D viewport actually
// draws from a screenshot of its canvas, and compares it with the DS lighting formula: the same formula the emulator test
// (packages/compiler/src/testing/lighting.rom.test.ts) checks a real ROM against. So editor and ROM are each held to the
// same numbers.
//
//   pnpm build && node tests/prototypes/e2e/lighting-parity.mjs
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-light-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/lit.gsds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

// ---- The DS formula (core's ds-lighting.ts), restated here so the script checks the app against numbers, not against its own code.
const AMBIENT = 8 / 31;
const PLAIN_DIFFUSE = 24 / 31;
const level = (intensity) => Math.round(Math.min(1, Math.max(0, intensity)) * 31);
/** The 0..255 brightness the DS gives a surface facing +Z, lit by a light at `degrees` and `intensity`; null = no light. */
function formula(degrees, intensity = 1) {
  if (degrees === null) return PLAIN_DIFFUSE * 255;
  const facing = Math.max(0, Math.cos((degrees * Math.PI) / 180));
  return Math.min(1, (level(intensity) / 31) * (AMBIENT + PLAIN_DIFFUSE * facing)) * 255;
}
const TOLERANCE = 10;

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
const body = () => page.evaluate(() => document.body.innerText);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => r.querySelector("span.flex-1")?.textContent.trim()).filter(Boolean));
const selectRow = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
  if (!row) throw new Error(`no scene tree row "${name}"`);
  row.click();
}, name);
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());
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
const getVector = (label) => page.evaluate((label) => {
  const heading = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === label && d.className.includes("text-[11px]"));
  return heading ? [...heading.nextElementSibling.querySelectorAll("input")].map((i) => Number(i.value)) : null;
}, label);
async function chooseMesh(prefix) {
  await page.evaluate((prefix) => {
    const label = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Mesh");
    const select = label.querySelector("select");
    const option = [...select.options].find((o) => o.textContent.trim().startsWith(prefix));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, prefix);
  await sleep(200);
}
const slider = () => page.evaluate(() => {
  const input = document.querySelector("input[type=range][aria-label=Intensity]");
  if (!input) return null;
  const text = [...document.querySelectorAll("span")].find((s) => /^\d+%$/.test(s.textContent.trim()));
  return { value: Number(input.value), shown: text?.textContent.trim(), note: document.body.innerText.match(/this is level (\d+)/)?.[1] };
});
async function chord(key, { shift = false } = {}) {
  await page.keyboard.down("Control");
  if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(250);
}

/** The canvas as pixels, plus its size on the page. */
async function canvasPng() {
  const el = await page.$("canvas");
  return PNG.sync.read(Buffer.from(await el.screenshot({ encoding: "base64" }), "base64"));
}
/** The median brightness (0..255) of small patches on the plane, away from the axes lines through the middle. */
async function planeBrightness(offsets = [[-60, -50], [60, -50], [-60, -90], [60, -90], [-30, -70], [30, -70]]) {
  await sleep(300); // let a frame render
  const png = await canvasPng();
  const cx = png.width / 2, cy = png.height / 2;
  const unit = png.height / 550; // the offsets below were chosen on a ~550px-tall canvas
  // The upper half of the plane only: below the middle the ground grid and the axes lines cross it.
  const values = offsets.map(([dx, dy]) => {
    let sum = 0, n = 0, redGreen = 0;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      const i = ((Math.round(cy + dy * unit) + y) * png.width + Math.round(cx + dx * unit) + x) * 4;
      sum += (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; n++;
      redGreen += Math.abs(png.data[i] - png.data[i + 2]);
    }
    return { mean: sum / n, cast: redGreen / n };
  });
  values.forEach((v) => assert.ok(v.cast < 6, "the plane is a neutral grey (no color cast from tone mapping or gamma)"));
  const sorted = values.map((v) => v.mean).sort((a, b) => a - b);
  return (sorted[2] + sorted[3]) / 2;
}
const within = (actual, want, what) => assert.ok(Math.abs(actual - want) <= TOLERANCE, `${what}: the viewport shows ${actual.toFixed(0)}, the DS formula says ${want.toFixed(0)}`);
const isDirty = async () => (await body()).includes("Unsaved changes");

try {
  await waitFor("http://127.0.0.1:9333/json/version");
  await waitFor("http://127.0.0.1:9229/json");
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null });
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes("index.html"));
    if (!page) await sleep(500);
  }
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });
  await mainEval(`(() => {
    const req = (process.mainModule && process.mainModule.require) || require;
    const { dialog } = req("electron");
    globalThis.__save = ${JSON.stringify(PROJECT_PATH)};
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__save });
    return "ok";
  })()`);
  await waitText("New Project");
  await click("New Project");
  await page.type("input[type=text]", "Lit");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- A flat grey plane facing +Z, scaled 3x as a real scene's meshes are.
  await addNode("MeshInstance3D");
  await chooseMesh("plane");
  await setVector("Rotation (deg)", [90, 0, 0]);
  await setVector("Scale", [3, 3, 3]);
  const planeName = (await rowNames()).at(-1);

  // ---- With no light, the plane is unlit: its own grey at full brightness, not black.
  await selectRow("Main");
  await sleep(300);
  within(await planeBrightness(), formula(null), "no light");
  pass("a scene with no light shows the plane's own grey at full brightness (unlit), not black");

  // ---- A new directional light points somewhere useful.
  await addNode("DirectionalLight3D");
  const lightName = (await rowNames()).at(-1);
  assert.deepEqual(await getVector("Rotation (deg)"), [-45, -30, 0], "a new light starts angled down and to the side");
  assert.deepEqual(await slider(), { value: 100, shown: "100%", note: "31" }, "the slider starts at 100% (DS level 31)");
  pass("a new DirectionalLight3D starts at rotation (-45, -30, 0) and its Intensity slider at 100%");

  // ---- The slider is on directional lights only.
  await selectRow(planeName);
  assert.equal(await slider(), null, "a mesh has no Intensity slider");
  await selectRow("Main");
  await addNode("OmniLight3D");
  assert.equal(await slider(), null, "an OmniLight3D has none");
  await addNode("Camera3D");
  assert.equal(await slider(), null, "a camera has none");
  await selectRow("Main");
  await selectRow((await rowNames()).find((n) => n.startsWith("OmniLight")));
  await menu("Scene");
  await click("Delete Node");
  await sleep(200);
  pass("the Intensity slider is on directional lights only (not on a mesh, an omni light or a camera)");

  // ---- Brightness follows the DS formula at every angle. The light is placed away from the plane, so its own gizmo doesn't cover it.
  await selectRow(lightName);
  await setVector("Position", [5, 4, 5]);
  const measured = {};
  for (const degrees of [0, 45, 60, 90]) {
    await setVector("Rotation (deg)", [0, -degrees, 0]);
    await selectRow("Main");
    measured[degrees] = await planeBrightness();
    within(measured[degrees], formula(degrees), `light at ${degrees} degrees`);
    await selectRow(lightName);
  }
  assert.ok(measured[0] - measured[90] > 120, "straight on is far brighter than edge on");
  pass(`the viewport's brightness matches the DS formula at 0/45/60/90 degrees (${[0, 45, 60, 90].map((d) => `${measured[d].toFixed(0)} vs ${formula(d).toFixed(0)}`).join(", ")})`);

  // ---- A scaled and a differently scaled mesh are lit the same (normals aren't scaled).
  await selectRow(lightName);
  await setVector("Rotation (deg)", [0, -60, 0]);
  await selectRow(planeName);
  await setVector("Scale", [2, 2, 2]);
  await selectRow("Main");
  // Points near the middle, which stay on the plane at every scale tried (a smaller plane doesn't reach the usual ones).
  const nearMiddle = [[-25, -35], [25, -35], [-25, -55], [25, -55]];
  const scale2 = await planeBrightness(nearMiddle);
  await selectRow(planeName);
  await setVector("Scale", [3, 1, 2]);
  await selectRow("Main");
  const scaleOdd = await planeBrightness(nearMiddle);
  await selectRow(planeName);
  await setVector("Scale", [3, 3, 3]);
  await selectRow("Main");
  const scale3 = await planeBrightness(nearMiddle);
  assert.ok(Math.abs(scale2 - scale3) <= 4 && Math.abs(scaleOdd - scale3) <= 4, `scale doesn't change the lighting (3x: ${scale3.toFixed(0)}, 2x: ${scale2.toFixed(0)}, (3,1,2): ${scaleOdd.toFixed(0)})`);
  within(scale3, formula(60), "the plane at 3x, light at 60 degrees");
  await selectRow(planeName);
  await setVector("Scale", [3, 3, 3]);
  pass("a plane scaled 3x, 2x and (3, 1, 2) is lit the same: normals aren't scaled");

  // ---- The slider, driven with the real keyboard and mouse.
  await selectRow(lightName);
  await setVector("Rotation (deg)", [0, 0, 0]);
  await page.focus("input[type=range][aria-label=Intensity]");
  await page.keyboard.press("Home");
  assert.deepEqual(await slider(), { value: 0, shown: "0%", note: "0" });
  await selectRow("Main");
  assert.ok((await planeBrightness()) < 25, "a light at 0% lights nothing: the plane is black");
  await selectRow(lightName);
  await page.focus("input[type=range][aria-label=Intensity]");
  await page.keyboard.press("End");
  assert.equal((await slider()).value, 100);
  for (let i = 0; i < 50; i++) await page.keyboard.press("ArrowLeft");
  assert.deepEqual(await slider(), { value: 50, shown: "50%", note: "16" }, "50 steps of the arrow key: 50%, which is DS level 16");
  await selectRow("Main");
  within(await planeBrightness(), formula(0, 0.5), "light at 50%");
  pass("the slider works from the keyboard (Home = 0% = black, End = 100%, arrows), 50% is DS level 16, and the viewport matches the formula");

  // ---- A mouse drag on the slider is one undo step.
  await selectRow(lightName);
  await blurFocus();
  const box = await (await page.$("input[type=range][aria-label=Intensity]")).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.5, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + box.width * (0.5 - i * 0.05), y); await sleep(30); }
  await page.mouse.up();
  await sleep(200);
  const dragged = (await slider()).value;
  assert.ok(dragged < 40 && dragged > 5, `the drag moved the slider (now ${dragged}%)`);
  await chord("z");
  assert.equal((await slider()).value, 50, "one Ctrl+Z put the whole drag back to 50%");
  await chord("z", { shift: true });
  assert.equal((await slider()).value, dragged, "and Ctrl+Shift+Z redid it");
  await chord("z");
  pass("dragging the slider with the mouse is one undo step");

  // ---- Saved, closed and reopened.
  await page.focus("input[type=range][aria-label=Intensity]");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft"); // 40%
  await blurFocus();
  assert.equal((await slider()).value, 40);
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
  const saved = JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
  const lightOnDisk = (function find(n) { return n.kind === "DirectionalLight3D" ? n : n.children.map(find).find(Boolean); })(saved.scene);
  assert.deepEqual(lightOnDisk.light, { intensity: 0.4 }, "the file has the light's intensity");
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await mainEval(`(() => { const req = (process.mainModule && process.mainModule.require) || require; req("electron").dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(PROJECT_PATH)}] }); return "ok"; })()`);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  await selectRow(lightName);
  assert.deepEqual(await slider(), { value: 40, shown: "40%", note: "12" }, "after reopening the slider shows 40% (level 12)");
  pass("the intensity is saved in the project file and comes back");

  // ---- A light shows where it points.
  await selectRow(lightName);
  await setVector("Position", [0, 3, 0]);
  await setVector("Rotation (deg)", [0, 0, 0]);
  await selectRow("Main");
  await sleep(300);
  const arrowAt = async () => {
    const png = await canvasPng();
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
      if (r > 220 && g > 190 && b < 150) { const p = i / 4; sx += p % png.width; sy += Math.floor(p / png.width); n++; }
    }
    return { x: sx / n, y: sy / n, n };
  };
  const forward = await arrowAt();
  await selectRow(lightName);
  await setVector("Rotation (deg)", [0, 90, 0]); // now travelling along -X instead of -Z
  await selectRow("Main");
  await sleep(300);
  const sideways = await arrowAt();
  assert.ok(forward.n > 40 && sideways.n > 40, "the light's yellow gizmo (icosahedron and arrow) is drawn");
  assert.ok(Math.hypot(forward.x - sideways.x, forward.y - sideways.y) > 8, `the arrow turned with the light (${forward.x.toFixed(0)},${forward.y.toFixed(0)} -> ${sideways.x.toFixed(0)},${sideways.y.toFixed(0)})`);
  pass("a directional light's gizmo has an arrow along its -Z that turns when the light is rotated");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "lighting-parity-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
