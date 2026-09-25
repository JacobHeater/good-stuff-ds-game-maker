// Prototype E2E for choosing a mesh's primitive in the Inspector
// (requirements/scene-designer/STORY.choose-mesh-primitive.md). Drives the built Electron app over CDP and
// stubs only the native file dialogs. It authors a scene with one mesh of each primitive through the real UI,
// checks the viewport and the hardware budget follow, saves, closes, reopens, and prints the saved path so the
// ROM test can compile it and compare the emulator's picture with a reference:
//
//   pnpm build && node tests/prototypes/e2e/mesh-primitive.mjs      (prints "SAVED <path>")
//   GSDS_ROM_PROJECT=<path> pnpm test:rom                          (the ROM draws all four shapes)
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-mesh-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/shapes.gsds`;
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
/** The Inspector's "Mesh" select: its current value and options, or null if the selected node has none. */
const meshSelect = () => page.evaluate(() => {
  const label = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Mesh");
  const select = label?.querySelector("select");
  return select ? { value: select.value, options: [...select.options].map((o) => o.textContent.trim()) } : null;
});
async function chooseMesh(primitive) {
  await page.evaluate((primitive) => {
    const label = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Mesh");
    const select = label.querySelector("select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, primitive);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, primitive);
  await sleep(200);
}
const triangles = async () => {
  await click("Hardware");
  await sleep(150);
  const match = /Triangles in scene\s*(\d+)/.exec(await body());
  assert.ok(match, "the Hardware tab shows a triangle count");
  return Number(match[1]);
};
/** Saves through the Project menu and waits for the status bar to stop saying "Unsaved changes" (the Output tab may be hidden). */
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const viewport = async () => (await (await page.$("canvas")).screenshot({ encoding: "base64" }));

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
    globalThis.__open = null;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(PROJECT_PATH)} });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__open] });
    return "ok";
  })()`);
  await waitText("New Project");
  await click("New Project");
  await page.type("input[type=text]", "Shapes");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  const baseline = await triangles();

  // ---- The Inspector offers all four, and shows each one's cost.
  await addNode("MeshInstance3D");
  const offered = await meshSelect();
  assert.equal(offered.value, "cube", "a new mesh starts as a cube");
  assert.deepEqual(offered.options, ["cube (12 tris)", "sphere (168 tris)", "plane (2 tris)", "cylinder (48 tris)"]);
  assert.equal(await triangles(), baseline + 12);
  pass("a MeshInstance3D's Inspector offers cube, sphere, plane and cylinder, with their triangle costs");

  // ---- Choosing one changes the viewport and the budget.
  const asCube = await viewport();
  await chooseMesh("sphere");
  assert.equal((await meshSelect()).value, "sphere");
  assert.notEqual(await viewport(), asCube, "the viewport redrew the mesh");
  assert.equal(await triangles(), baseline + 168, "the budget rose by the difference between a cube and a sphere (156)");
  pass("choosing a sphere changes the viewport and moves the triangle budget by 156");

  await chooseMesh("cube");
  assert.equal(await triangles(), baseline + 12, "and it goes back down");
  await page.evaluate(() => {}); // (no-op: keep the flow readable)
  assert.ok(!(await body()).includes("Mesh: "), "the old read-only 'Mesh: cube' line is gone");
  pass("changing it back restores the cost");

  // ---- Choosing the same primitive again isn't an edit.
  await chooseMesh("sphere");
  await chooseMesh("cube");
  await waitText("Unsaved changes");
  await saveProject();
  await chooseMesh("cube");
  await sleep(200);
  assert.ok(!(await body()).includes("Unsaved changes"), "re-choosing the current primitive doesn't make the project look edited");
  pass("re-choosing the current primitive isn't treated as an unsaved change");

  // ---- Build the four-shape scene: cube, sphere, plane, cylinder side by side, plus a camera and a light.
  const shapes = [["cube", -3], ["sphere", -1], ["plane", 1], ["cylinder", 3]];
  await selectRow("Main");
  // Reuse the mesh already there as the cube; add three more under the root.
  await selectRow("MeshInstance3D");
  await setVector("Position", [-3, 0, 0]);
  for (const [primitive, x] of shapes.slice(1)) {
    await selectRow("Main");
    await addNode("MeshInstance3D");
    await chooseMesh(primitive);
    await setVector("Position", [x, 0, 0]);
    if (primitive === "plane") await setVector("Rotation (deg)", [70, 0, 0]); // a plane faces +Y; +70 degrees about X tilts it toward a camera at +Z
  }
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 1, 8]);
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  await setVector("Rotation (deg)", [-50, 30, 0]);
  assert.equal(await triangles(), baseline + 12 + 168 + 2 + 48);
  pass("a scene with one of each primitive costs 12 + 168 + 2 + 48 triangles");
  await page.screenshot({ path: join(HERE, "mesh-primitive-editor.png") });

  // ---- Saved, closed and reopened: every mesh is still what it was.
  await saveProject();
  const onDisk = JSON.parse(readFileSync(PROJECT_PATH, "utf8"));
  const primitivesOnDisk = [];
  (function walk(n) { if (n.mesh) primitivesOnDisk.push(n.mesh.primitive); n.children.forEach(walk); })(onDisk.scene);
  assert.deepEqual(primitivesOnDisk, ["cube", "sphere", "plane", "cylinder"], "the file has each primitive");
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await mainEval(`globalThis.__open = ${JSON.stringify(PROJECT_PATH)}`);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  const reopened = [];
  for (const name of ["MeshInstance3D", "MeshInstance3D2", "MeshInstance3D3", "MeshInstance3D4"]) {
    const found = await page.evaluate((name) => !![...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name), name);
    if (!found) continue;
    await selectRow(name);
    reopened.push((await meshSelect()).value);
  }
  assert.deepEqual(reopened.sort(), ["cube", "cylinder", "plane", "sphere"], "after reopening, each mesh is still its primitive");
  assert.equal(await triangles(), baseline + 12 + 168 + 2 + 48);
  pass("the choices are saved and survive closing and reopening");

  console.log(`\nAll ${checks} checks passed.`);
  console.log(`SAVED ${PROJECT_PATH}`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "mesh-primitive-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
