// Prototype E2E for importing an .obj model (requirements/scene-designer/STORY.import-obj-model.md).
// Drives the built Electron app over CDP and stubs only the native file dialogs; the parser, IPC, project
// file and the compiler/toolchain (for the final export) are all real. Needs tools/ds-toolchain for the export.
//
//   pnpm build && node tests/prototypes/e2e/import-obj.mjs        (prints "SAVED <path>")
//   GSDS_ROM_PROJECT=<path> pnpm test:rom                         (the emulator draws the model)
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const HOUSE = join(HERE, "models", "house.obj").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-obj-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/village.gsds`;
const FINAL_PATH = `${work}/village-final.gsds`;
const ROM_PATH = `${work}/village.nds`;
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
/** Save dialog answers `__save`; open dialog answers `__open` (null = cancel). Both record their calls. */
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
const buttonLabels = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));
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
const meshSelect = () => page.evaluate(() => {
  const label = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Mesh");
  const select = label?.querySelector("select");
  return select ? { value: select.value, selectedText: select.selectedOptions[0]?.textContent.trim(), options: [...select.options].map((o) => o.textContent.trim()) } : null;
});
/** Chooses the Mesh select's option whose text starts with `prefix`. */
async function chooseMeshOption(prefix) {
  await page.evaluate((prefix) => {
    const label = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Mesh");
    const select = label.querySelector("select");
    const option = [...select.options].find((o) => o.textContent.trim().startsWith(prefix));
    if (!option) throw new Error(`no Mesh option starting with "${prefix}"`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, prefix);
  await sleep(200);
}
const triangles = async () => {
  await click("Hardware");
  await sleep(150);
  const match = /Triangles in scene\s*(\d+)/.exec(await body());
  assert.ok(match, "the Hardware tab shows a triangle count");
  return Number(match[1]);
};
const showOutput = async () => { await click("Output"); await sleep(150); };
const viewport = async () => (await (await page.$("canvas")).screenshot({ encoding: "base64" }));
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = (path) => JSON.parse(readFileSync(path, "utf8"));
const importFile = async (path) => { await answerOpen(path); await menu("Scene"); await click("Import Model (.obj)..."); await sleep(400); };
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
  await installDialogs();
  await waitText("New Project");

  // ---- A 2D project doesn't offer Import.
  await answerSave(`${work}/flat.gsds`);
  await click("New Project");
  await page.type("input[type=text]", "Flat");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await menu("Scene");
  assert.ok(!(await buttonLabels()).includes("Import Model (.obj)..."), "a 2D project's Scene menu has no Import entry");
  await click("Scene");
  await menu("Project");
  await click("Close Project");
  await waitText("New Project");
  pass("a 2D project doesn't offer Import Model");

  // ---- A 3D project: Import is in the Scene menu, not the Project menu.
  await answerSave(PROJECT_PATH);
  await click("New Project");
  await page.type("input[type=text]", "Village");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  const baseline = await triangles();
  await showOutput();
  await menu("Project");
  assert.ok(!(await buttonLabels()).some((l) => l.includes("Import")), "the Project menu has no Import entry");
  await click("Project");
  await menu("Scene");
  assert.ok((await buttonLabels()).includes("Import Model (.obj)..."), "the Scene menu of a 3D project offers Import Model (.obj)...");
  await click("Scene");
  pass("Import Model (.obj)... is in the Scene menu of a 3D project and not in the Project menu");

  // ---- Cancelling does nothing.
  const rowsBefore = await rowNames();
  const logBefore = await body();
  await answerOpen(null);
  await menu("Scene");
  await click("Import Model (.obj)...");
  await sleep(500);
  const calls = await openCalls();
  assert.equal(calls.at(-1).title, "Import Model");
  assert.deepEqual(calls.at(-1).filters[0].extensions, ["obj"]);
  assert.deepEqual(await rowNames(), rowsBefore);
  assert.ok(!(await isDirty()), "cancelling leaves the project unedited");
  assert.equal((await body()).length, logBefore.length, "and logs nothing");
  pass("cancelling the file dialog changes nothing");

  // ---- Bad files are refused with a reason, and change nothing.
  const bad = {
    "no-faces.obj": ["v 0 0 0\nv 1 0 0\n", /no faces/],
    "missing-vertex.obj": ["v 0 0 0\nv 1 0 0\nf 1 2 3\n", /Line 3.*vertex 3/],
    "too-big.obj": ["v 0 0 0\nv 20 0 0\nv 0 1 0\nf 1 2 3\n", /Line 2.*outside the DS's range/],
    "too-many.obj": [Array.from({ length: 2100 }, (_, i) => `v ${i % 5} 0 0\nv ${i % 5} 1 0\nv ${(i % 5) + 1} 0 ${i * 0.001 + 0.1}\nf ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`).join("\n"), /2100 triangles.*2048/],
    "notes.obj": ["hello, this is not a model at all\n", /no faces/]
  };
  for (const [file, [text, expected]] of Object.entries(bad)) {
    writeFileSync(`${work}/${file}`, text);
    await importFile(`${work}/${file}`);
    const out = await body();
    assert.ok(out.includes(`Could not import "${file}"`), `${file}: the log names the file`);
    assert.match(out, expected, `${file}: the log says why`);
    assert.deepEqual(await rowNames(), rowsBefore, `${file}: nothing was added`);
    assert.ok(!(await isDirty()), `${file}: the project is unedited`);
  }
  pass("no-faces, a missing vertex, a coordinate out of range, too many triangles and a non-model are each refused with a reason (line numbers where there are any), adding nothing");

  // ---- Importing the house.
  const emptyView = await viewport();
  await importFile(HOUSE);
  await waitText('Imported model "house" (14 triangles)');
  let out = await body();
  assert.match(out, /Warning: Materials/, "materials are reported as ignored");
  assert.match(out, /Warning: The file has no normals/, "flat shading is reported");
  assert.deepEqual((await rowNames()).filter((n) => n === "house"), ["house"], "a node named after the file was added");
  const inspector = await meshSelect();
  assert.equal(inspector.selectedText, "house (14 tris, imported)", "it's selected and uses the model");
  assert.deepEqual(inspector.options, ["cube (12 tris)", "sphere (168 tris)", "plane (2 tris)", "cylinder (48 tris)", "house (14 tris, imported)"]);
  assert.notEqual(await viewport(), emptyView, "the viewport draws the model");
  assert.equal(await triangles(), baseline + 14, "the Hardware tab counts the model's 14 triangles");
  assert.ok(await isDirty(), "importing is an unsaved change");
  pass("importing the house adds a selected node using it, draws it, counts its 14 triangles and reports what was ignored");
  await showOutput();

  // ---- Reuse: another mesh can switch to the model, and back to a primitive.
  await setVector("Position", [-1.6, 0, 0]);
  await setVector("Rotation (deg)", [0, 25, 0]);
  await selectRow("Main");
  await addNode("MeshInstance3D");
  assert.equal((await meshSelect()).value, "cube");
  await chooseMeshOption("house");
  assert.equal((await meshSelect()).selectedText, "house (14 tris, imported)");
  assert.equal(await triangles(), baseline + 28, "two houses cost 28");
  await setVector("Position", [1.4, 0, 0.5]);
  await setVector("Rotation (deg)", [0, -35, 0]);
  await setVector("Scale", [0.7, 0.7, 0.7]);
  await chooseMeshOption("sphere");
  assert.equal(await triangles(), baseline + 14 + 168, "switching to a sphere swaps its cost");
  await chooseMeshOption("house");
  assert.equal(await triangles(), baseline + 28);
  pass("a second mesh can use the same model, and switch to a primitive and back");
  await showOutput();

  // ---- A cube beside them, a camera and a light; then save.
  await selectRow("Main");
  await addNode("MeshInstance3D");
  await setVector("Position", [3.2, 0.5, -0.5]);
  await setVector("Scale", [0.8, 0.8, 0.8]);
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [1, 3.2, 7]);
  await setVector("Rotation (deg)", [-20, 0, 0]);
  await selectRow("Main");
  await addNode("DirectionalLight3D");
  await setVector("Rotation (deg)", [-50, 30, 0]);
  await saveProject();
  const saved = readProject(PROJECT_PATH);
  assert.equal(saved.meshes.length, 1, "the file has one model, shared by both houses");
  assert.equal(saved.meshes[0].name, "house");
  assert.equal(saved.meshes[0].indices.length / 3, 14);
  const users = [];
  (function walk(n) { if (n.mesh?.importedMeshId) users.push(n.mesh.importedMeshId); n.children.forEach(walk); })(saved.scene);
  assert.deepEqual(users, [saved.meshes[0].id, saved.meshes[0].id]);
  copyFileSync(PROJECT_PATH, FINAL_PATH);
  pass("saving embeds the model once in the project file, referenced by both houses");

  // ---- Closed and reopened: still drawn, still counted, still selectable.
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await answerOpen(PROJECT_PATH);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  assert.equal(await triangles(), baseline + 14 + 14 + 12, "the reopened project counts both houses and the cube");
  await selectRow("house");
  assert.equal((await meshSelect()).selectedText, "house (14 tris, imported)");
  pass("the imported model survives closing and reopening");

  // ---- Export a real ROM from the reopened project (real compiler and toolchain).
  await showOutput();
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 90000);
  const rom = readFileSync(ROM_PATH);
  assert.equal(rom.subarray(0, 8).toString(), "HOMEBREW");
  assert.ok(rom.length > 100 * 1024);
  pass("Export ROM builds a valid .nds from the project with the imported model");

  // ---- Unused models aren't saved (checked last, since it edits the project).
  // The two houses are the node named after the file and the second mesh (still named "MeshInstance3D").
  for (const name of ["house", "MeshInstance3D"]) {
    await selectRow(name);
    await menu("Scene");
    await click("Delete Node");
    await sleep(200);
  }
  assert.ok(!(await rowNames()).includes("house") && !(await rowNames()).includes("MeshInstance3D"), "both houses are gone");
  await saveProject();
  assert.ok(!("meshes" in readProject(PROJECT_PATH)), "with no mesh using it, the model isn't in the file");
  pass("a model no mesh uses is dropped from the file on save");

  console.log(`\nAll ${checks} checks passed.`);
  console.log(`SAVED ${FINAL_PATH}`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "import-obj-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
