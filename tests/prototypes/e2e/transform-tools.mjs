// Prototype E2E for the toolbar's Select / Move / Rotate / Scale tools
// (requirements/scene-designer/STORY.transform-tools-on-toolbar.md). Drives the built Electron app over CDP with
// REAL mouse events: it finds each gizmo handle by its color in a screenshot of the 3D canvas, presses on it,
// drags, and reads the Inspector to see what the drag did. Only the native save dialog is stubbed.
//
//   pnpm build && node tests/prototypes/e2e/transform-tools.mjs
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// pngjs comes from the compiler package (the e2e folder has only puppeteer-core), so decode screenshots here in Node.
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-tools-")).replace(/\\/g, "/");
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
const selectRow = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
  if (!row) throw new Error(`no scene tree row "${name}"`);
  row.click();
}, name);
const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => r.querySelector("span.flex-1")?.textContent.trim()).filter(Boolean));
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
  if (!heading) return null;
  return [...heading.nextElementSibling.querySelectorAll("input")].map((i) => Number(i.value));
}, label);
const isDirty = async () => (await body()).includes("Unsaved changes");
const toolButtons = () => page.evaluate(() => {
  const group = document.querySelector("[aria-label=Tools]");
  return group ? [...group.querySelectorAll("button")].map((b) => ({ label: b.textContent.trim(), pressed: b.getAttribute("aria-pressed") === "true", title: b.title })) : null;
});
const activeTool = async () => (await toolButtons()).filter((b) => b.pressed).map((b) => b.label);
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());

/** A screenshot of the 3D canvas and where it is on the page. */
async function canvasShot() {
  const el = await page.$("canvas");
  const box = await el.boundingBox();
  return { b64: await el.screenshot({ encoding: "base64" }), box };
}
/**
 * What appeared between two canvas screenshots, by color: for each of red / green / blue, the pixels that are
 * strongly that color now and weren't before. Coordinates are returned in CSS pixels on the page.
 */
async function newHandles(base, now) {
  const a = PNG.sync.read(Buffer.from(base.b64, "base64"));
  const b = PNG.sync.read(Buffer.from(now.b64, "base64"));
  assert.equal(a.width, b.width);
  const scale = b.width / now.box.width;
  const classes = { red: [], green: [], blue: [] };
  let changed = 0;
  for (let i = 0; i < b.data.length; i += 4) {
    const d = Math.abs(b.data[i] - a.data[i]) + Math.abs(b.data[i + 1] - a.data[i + 1]) + Math.abs(b.data[i + 2] - a.data[i + 2]);
    if (d < 90) continue;
    changed++;
    const r = b.data[i], g = b.data[i + 1], bl = b.data[i + 2];
    const px = i / 4, x = (px % b.width) / scale + now.box.x, y = Math.floor(px / b.width) / scale + now.box.y;
    if (r > 180 && g < 90 && bl < 90) classes.red.push([x, y]);
    else if (g > 180 && r < 90 && bl < 90) classes.green.push([x, y]);
    else if (bl > 180 && r < 90 && g < 90) classes.blue.push([x, y]);
  }
  const summarize = (pts) => ({ count: pts.length, pts });
  return { changed, red: summarize(classes.red), green: summarize(classes.green), blue: summarize(classes.blue) };
}
/** How many pixels differ between two canvas screenshots. */
async function differingPixels(a, b) {
  const r = await newHandles(a, b);
  return r.changed;
}
/** The point of `cluster` farthest from (cx, cy): the tip of a handle, which is what's safest to grab. */
function tip(cluster, cx, cy) {
  return cluster.pts.reduce((best, p) => (Math.hypot(p[0] - cx, p[1] - cy) > Math.hypot(best[0] - cx, best[1] - cy) ? p : best), cluster.pts[0]);
}
async function drag(from, to, steps = 10) {
  await page.mouse.move(from[0], from[1]);
  await sleep(120); // let the hover register so the gizmo knows which handle is under the pointer
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    await sleep(25);
  }
  await page.mouse.up();
  await sleep(250);
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

/** Finds the gizmo (against `base`), returns per-color clusters and the gizmo's own center (mean of everything new). */
async function findGizmo(base) {
  const now = await canvasShot();
  const found = await newHandles(base, now);
  const all = [...found.red.pts, ...found.green.pts, ...found.blue.pts];
  assert.ok(all.length > 20, `a gizmo is visible (found ${all.length} colored pixels)`);
  const cx = all.reduce((s, p) => s + p[0], 0) / all.length;
  const cy = all.reduce((s, p) => s + p[1], 0) / all.length;
  return { ...found, cx, cy };
}

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
    globalThis.__save = null;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__save });
    return "ok";
  })()`);
  await waitText("New Project");

  const createProject = async (name, mode) => {
    await mainEval(`globalThis.__save = ${JSON.stringify(`${work}/${name}.gsds`)}`);
    await click("New Project");
    await page.type("input[type=text]", name);
    await page.evaluate((mode) => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith(mode)).click(), mode);
    await click("Create Project…");
    await waitText("Scene Tree");
  };

  // ---- A 2D project has no tools.
  await createProject("Flat", "2D");
  assert.equal(await toolButtons(), null, "a 2D project's toolbar has no tools");
  await menu("Project");
  await click("Close Project");
  await waitText("New Project");
  pass("a 2D project's toolbar has no tools");

  // ---- A 3D project: four tools, Select active, nothing edited by choosing.
  await createProject("Gizmos", "3D");
  const tools = await toolButtons();
  assert.deepEqual(tools.map((t) => t.label), ["Select", "Move", "Rotate", "Scale"]);
  assert.deepEqual(tools.map((t) => t.title), ["Select (Q)", "Move (W)", "Rotate (E)", "Scale (R)"]);
  assert.deepEqual(await activeTool(), ["Select"]);
  await click("Move");
  assert.deepEqual(await activeTool(), ["Move"], "Move is the only active tool");
  await click("Scale");
  await click("Rotate");
  assert.deepEqual(await activeTool(), ["Rotate"]);
  assert.ok(!(await isDirty()), "choosing tools isn't an edit");
  pass("a 3D project has Select / Move / Rotate / Scale (Select first); choosing one is not an edit");

  // ---- Keyboard shortcuts.
  await blurFocus();
  for (const [key, expected] of [["w", "Move"], ["e", "Rotate"], ["r", "Scale"], ["q", "Select"], ["W", "Move"]]) {
    await page.keyboard.press(key);
    assert.deepEqual(await activeTool(), [expected], `${key} selects ${expected}`);
  }
  await addNode("MeshInstance3D");
  await page.focus("input[type=number]");
  await page.keyboard.press("e");
  assert.deepEqual(await activeTool(), ["Move"], "typing in a field doesn't switch tools");
  await blurFocus();
  pass("Q / W / E / R switch tools, and are ignored while typing in a field");

  // ---- Put the mesh off the origin, so the gizmo doesn't sit on the axes helper's lines.
  await click("Select");
  await setVector("Position", [1.5, 1, -1]);
  await blurFocus();
  await sleep(300);
  const base = await canvasShot(); // the scene with no gizmo at all
  const baseAgain = await canvasShot();
  assert.ok((await differingPixels(base, baseAgain)) < 5, "the viewport renders the same frame twice (a stable baseline)");

  // ---- Select shows no gizmo; Move does.
  await click("Move");
  await sleep(300);
  const move = await findGizmo(base);
  await page.screenshot({ path: join(HERE, "transform-tools-move.png") });
  assert.ok(move.red.count > 3 && move.green.count > 3 && move.blue.count > 3, "the move gizmo has red, green and blue handles");
  await click("Select");
  await sleep(300);
  assert.ok((await differingPixels(base, await canvasShot())) < 5, "Select shows no gizmo");
  pass("Select shows no gizmo; Move shows red, green and blue handles on the selected mesh");

  // ---- Dragging the move gizmo's X handle changes only X.
  await click("Move");
  await sleep(300);
  const g = await findGizmo(base);
  const start = tip(g.red, g.cx, g.cy);
  const dir = [start[0] - g.cx, start[1] - g.cy];
  const len = Math.hypot(...dir);
  const before = await getVector("Position");
  const orbitBefore = await canvasShot();
  await drag(start, [start[0] + (dir[0] / len) * 40, start[1] + (dir[1] / len) * 40]);
  const after = await getVector("Position");
  assert.ok(Math.abs(after[0] - before[0]) > 0.15, `X changed (${before[0]} -> ${after[0]})`);
  assert.ok(near(after[1], before[1]) && near(after[2], before[2]), `Y and Z didn't (${before} -> ${after})`);
  assert.ok(await isDirty(), "moving is an unsaved change");
  assert.deepEqual((await rowNames()).includes("MeshInstance3D"), true);
  const stillSelected = await page.evaluate(() => [...document.querySelectorAll("label span")].some((s) => s.textContent.trim() === "Mesh"));
  assert.ok(stillSelected, "the mesh is still selected after the drag (the release didn't deselect it)");
  pass(`dragging the move gizmo's X handle moved X by ${(after[0] - before[0]).toFixed(2)} and left Y and Z alone; the node stayed selected`);

  // Orbit check: the far corner of the view (grid, well away from the mesh) is unchanged, so the drag didn't orbit.
  const orbitAfter = await canvasShot();
  const cornerChanged = (() => {
    const A = PNG.sync.read(Buffer.from(orbitBefore.b64, "base64")), B = PNG.sync.read(Buffer.from(orbitAfter.b64, "base64"));
    let n = 0;
    for (let y = Math.floor(A.height * 0.7); y < A.height; y++) {
      for (let x = 0; x < Math.floor(A.width * 0.3); x++) {
        const i = (y * A.width + x) * 4;
        if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 60) n++;
      }
    }
    return n;
  })();
  assert.ok(cornerChanged < 30, `the drag didn't orbit the camera (${cornerChanged} pixels changed in the far corner)`);
  pass("dragging a handle doesn't orbit the view");

  // ---- Rotate: drag a ring.
  await setVector("Position", [1.5, 1, -1]);
  await setVector("Rotation (deg)", [0, 0, 0]);
  await blurFocus();
  await click("Select");
  await sleep(300);
  const rBase = await canvasShot();
  await click("Rotate");
  await sleep(300);
  const r = await findGizmo(rBase);
  assert.ok(r.blue.count > 3, "the rotate gizmo has a blue (Z) ring");
  // Grab the blue ring at its point nearest the gizmo's edge and pull it along the tangent.
  const ringPoint = tip(r.blue, r.cx, r.cy);
  const radial = [ringPoint[0] - r.cx, ringPoint[1] - r.cy];
  const rlen = Math.hypot(...radial);
  const tangent = [-radial[1] / rlen, radial[0] / rlen];
  const rotBefore = await getVector("Rotation (deg)");
  await drag(ringPoint, [ringPoint[0] + tangent[0] * 70, ringPoint[1] + tangent[1] * 70]);
  const rotAfter = await getVector("Rotation (deg)");
  assert.ok(Math.abs(rotAfter[2] - rotBefore[2]) > 5, `Z rotation changed (${rotBefore} -> ${rotAfter})`);
  assert.ok(near(rotAfter[0], rotBefore[0], 0.05) && near(rotAfter[1], rotBefore[1], 0.05), `X and Y rotation didn't (${rotBefore} -> ${rotAfter})`);
  pass(`dragging the blue ring rotated Z by ${(rotAfter[2] - rotBefore[2]).toFixed(1)} degrees and left X and Y alone`);

  // ---- Scale: drag the X handle.
  await setVector("Rotation (deg)", [0, 0, 0]);
  await blurFocus();
  await click("Select");
  await sleep(300);
  const sBase = await canvasShot();
  await click("Scale");
  await sleep(300);
  const s = await findGizmo(sBase);
  assert.ok(s.red.count > 3, "the scale gizmo has a red (X) handle");
  const sStart = tip(s.red, s.cx, s.cy);
  const sDir = [sStart[0] - s.cx, sStart[1] - s.cy];
  const sLen = Math.hypot(...sDir);
  const scaleBefore = await getVector("Scale");
  await drag(sStart, [sStart[0] + (sDir[0] / sLen) * 40, sStart[1] + (sDir[1] / sLen) * 40]);
  const scaleAfter = await getVector("Scale");
  assert.ok(Math.abs(scaleAfter[0] - scaleBefore[0]) > 0.1, `X scale changed (${scaleBefore} -> ${scaleAfter})`);
  assert.ok(near(scaleAfter[1], scaleBefore[1]) && near(scaleAfter[2], scaleBefore[2]), `Y and Z scale didn't (${scaleBefore} -> ${scaleAfter})`);
  pass(`dragging the scale gizmo's X handle changed X scale to ${scaleAfter[0]} and left Y and Z alone`);

  // ---- Nothing to manipulate: the scene root, and a camera under Scale.
  await click("Move");
  await selectRow("Main");
  await sleep(300);
  const rootBase = await canvasShot();
  await click("Select");
  await sleep(300);
  const rootSelect = await canvasShot();
  assert.ok((await differingPixels(rootSelect, rootBase)) < 5, "no gizmo on the scene root, even with Move active");
  await addNode("Camera3D");
  await setVector("Position", [-2, 1, 2]);
  await blurFocus();
  await click("Select");
  await sleep(300);
  const camSelect = await canvasShot();
  await click("Scale");
  await sleep(300);
  assert.ok((await differingPixels(camSelect, await canvasShot())) < 5, "no scale gizmo on a camera");
  await click("Move");
  await sleep(300);
  const camMove = await findGizmo(camSelect);
  assert.ok(camMove.red.count + camMove.green.count + camMove.blue.count > 20, "but the camera can be moved");
  pass("no gizmo on the scene root; no scale gizmo on a camera (which can still be moved)");

  // ---- A nested node moves in its parent's space.
  await selectRow("Main");
  await addNode("Node3D");
  await setVector("Rotation (deg)", [0, 90, 0]);
  await setVector("Scale", [2, 2, 2]);
  await setVector("Position", [-2, 0, -2]);
  await addNode("MeshInstance3D"); // nests under the Node3D that's selected
  await setVector("Position", [0, 0, 0]);
  await blurFocus();
  await click("Select");
  await sleep(300);
  const nBase = await canvasShot();
  await click("Move");
  await sleep(300);
  const n = await findGizmo(nBase);
  const nStart = tip(n.red, n.cx, n.cy);
  const nDir = [nStart[0] - n.cx, nStart[1] - n.cy];
  const nLen = Math.hypot(...nDir);
  const nBefore = await getVector("Position");
  await drag(nStart, [nStart[0] + (nDir[0] / nLen) * 40, nStart[1] + (nDir[1] / nLen) * 40]);
  const nAfter = await getVector("Position");
  // World X is the parent's local Z axis (the parent is turned 90 degrees about Y), so the local Z changes and X and Y don't.
  assert.ok(Math.abs(nAfter[2] - nBefore[2]) > 0.05, `local Z changed (${nBefore} -> ${nAfter})`);
  assert.ok(near(nAfter[0], nBefore[0], 0.01) && near(nAfter[1], nBefore[1], 0.01), `local X and Y didn't (${nBefore} -> ${nAfter})`);
  pass("a mesh under a turned and scaled parent is moved in the parent's space (its stored position stays relative)");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "transform-tools-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
