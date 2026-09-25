// Prototype E2E for textures on meshes (requirements/scene-designer/STORY.mesh-textures.md). Drives the built Electron
// app over CDP and stubs only the native file dialogs. It writes real PNG files (good and bad), imports them through the
// real UI, reads the colors the 3D viewport actually draws from a screenshot of its canvas, saves, reopens, undoes, and
// exports a real ROM.
//
//   pnpm build && node tests/prototypes/e2e/texture-mesh.mjs
//
// Needs tools/ds-toolchain for the final export. Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
// pngjs comes from the compiler package (this folder has only puppeteer-core): it writes the test images and reads screenshots.
const { PNG } = createRequire(join(HERE, "../../../packages/compiler/package.json"))("pngjs");
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const HOUSE = join(HERE, "models", "house.obj").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-tex-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/textured.gsds`;
const ROM_PATH = `${work}/textured.nds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

// ---- Test images.
function writePng(path, width, height, pixel) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) png.data.set(pixel(x, y), (y * width + x) * 4);
  writeFileSync(path, PNG.sync.write(png));
}
const quadrant = (size) => (x, y) => (y < size / 2 ? (x < size / 2 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : x < size / 2 ? [0, 0, 255, 255] : [255, 255, 0, 255]);
writePng(`${work}/quadrants.png`, 16, 16, quadrant(16));
writePng(`${work}/checker32.png`, 32, 32, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [255, 255, 255, 255] : [40, 40, 40, 255]);
writePng(`${work}/odd-size.png`, 100, 60, () => [10, 20, 30, 255]);
writePng(`${work}/huge.png`, 1024, 1024, () => [10, 20, 30, 255]);
writePng(`${work}/soft-edges.png`, 8, 8, (x) => [200, 100, 50, x === 0 ? 100 : x === 1 ? 0 : 255]); // one column partly clear, one fully clear
writeFileSync(`${work}/not-a-png.png`, "this is not an image at all");
writeFileSync(`${work}/quad-uv.obj`, "v -1 -1 0\nv 1 -1 0\nv 1 1 0\nv -1 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nf 1/1 2/2 3/3 4/4\n");

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
const click = (label, { endsWith = false, startsWith = false } = {}) => page.evaluate((label, endsWith, startsWith) => {
  const b = [...document.querySelectorAll("button")].find((x) => {
    const t = x.textContent.trim();
    return endsWith ? t.endsWith(label) : startsWith ? t.startsWith(label) : t === label;
  });
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}, label, endsWith, startsWith);
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
const isDirty = async () => (await body()).includes("Unsaved changes");
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
/** The Inspector's Texture field: its selected text, options, whether it's disabled, and whether the import button is there. */
const textureField = () => page.evaluate(() => {
  const label = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Texture");
  const select = label?.querySelector("select");
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Import PNG...");
  return {
    select: select ? { selected: select.selectedOptions[0]?.textContent.trim(), options: [...select.options].map((o) => o.textContent.trim()), disabled: select.disabled } : null,
    button: button ? { disabled: button.disabled } : null,
    note: document.body.innerText.includes("has no texture coordinates")
  };
});
async function chooseTexture(prefix) {
  await page.evaluate((prefix) => {
    const label = [...document.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent.trim() === "Texture");
    const select = label.querySelector("select");
    const option = [...select.options].find((o) => o.textContent.trim().startsWith(prefix));
    if (!option) throw new Error(`no Texture option starting with "${prefix}"`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, prefix);
  await sleep(200);
}
async function chooseMeshSource(prefix) {
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
async function importPng(path) {
  await answerOpen(path);
  await click("Import PNG...");
  await sleep(500);
}
const bottomTab = async (name) => { await click(name); await sleep(150); };
const textureBytes = async () => {
  await bottomTab("Hardware");
  const m = /Textures in scene\s*(\d+) \/ (\d+) bytes/.exec(await body());
  assert.ok(m, "the Hardware tab shows texture memory");
  return { used: Number(m[1]), limit: Number(m[2]) };
};
async function chord(key, { shift = false } = {}) {
  await page.keyboard.down("Control");
  if (shift) await page.keyboard.down("Shift");
  await page.keyboard.press(key);
  if (shift) await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await sleep(250);
}
const saveProject = async () => {
  await menu("Project");
  await click("Save Project");
  await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 8000 });
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));

/** Counts the strongly red / green / blue / yellow pixels the viewport draws, from a screenshot of its canvas. */
async function viewportColors() {
  const el = await page.$("canvas");
  const png = PNG.sync.read(Buffer.from(await el.screenshot({ encoding: "base64" }), "base64"));
  const counts = { red: 0, green: 0, blue: 0, yellow: 0, total: png.width * png.height };
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    const strong = Math.max(r, g, b);
    if (strong < 70) continue;
    const [hr, hg, hb] = [r, g, b].map((c) => c > strong * 0.6);
    if (hr && !hg && !hb && g < 60 && b < 60) counts.red++;
    else if (!hr && hg && !hb && r < 60 && b < 60) counts.green++;
    else if (!hr && !hg && hb && r < 60 && g < 60) counts.blue++;
    else if (hr && hg && !hb && b < 60) counts.yellow++;
  }
  return counts;
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
  await installDialogs();
  await waitText("New Project");
  await answerSave(PROJECT_PATH);
  await click("New Project");
  await page.type("input[type=text]", "Textured");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- The Inspector offers a texture on a mesh, and nothing on other nodes.
  let f = await textureField();
  assert.equal(f.select, null, "the scene root has no Texture field");
  assert.equal(f.button, null);
  await addNode("MeshInstance3D");
  f = await textureField();
  assert.deepEqual(f.select.options, ["None"]);
  assert.equal(f.select.selected, "None");
  assert.deepEqual(f.button, { disabled: false });
  await selectRow("Main");
  await addNode("Camera3D");
  assert.equal((await textureField()).select, null, "a camera has no Texture field");
  await selectRow("MeshInstance3D");
  pass("a mesh's Inspector has a Texture field (None) and an Import PNG button; the scene root and a camera have neither");

  // ---- Cancelling does nothing. (Save first, so "unedited" means something.)
  await saveProject();
  await answerOpen(null);
  await click("Import PNG...");
  await sleep(500);
  const call = (await openCalls()).at(-1);
  assert.equal(call.title, "Import Texture");
  assert.deepEqual(call.filters[0].extensions, ["png"]);
  assert.ok(!(await isDirty()), "cancelling leaves the project unedited");
  assert.deepEqual((await textureField()).select.options, ["None"]);
  pass("cancelling the file dialog changes nothing (and the dialog is filtered to .png)");

  // ---- Bad files are refused with a reason.
  await bottomTab("Output");
  const bad = [
    ["odd-size.png", /100 x 60 pixels.*power of two from 8 to 1024.*the width \(100\) and the height \(60\) aren't/],
    ["huge.png", /1024 x 1024 texture would need 2048 KB of texture memory, but the DS has 512 KB/],
    ["not-a-png.png", /isn't a PNG image the app can read/]
  ];
  for (const [file, expected] of bad) {
    await importPng(`${work}/${file}`);
    const out = await body();
    assert.ok(out.includes(`Could not import "${file}"`), `${file}: the log names the file`);
    assert.match(out, expected, `${file}: the log says why`);
    assert.deepEqual((await textureField()).select.options, ["None"], `${file}: nothing was added`);
    assert.ok(!(await isDirty()), `${file}: the project is unedited`);
  }
  pass("a 100 x 60 image, a 1024 x 1024 image and a file that isn't a PNG are each refused with a reason, adding nothing");

  // ---- A good PNG textures the mesh, and the viewport shows its colors.
  await selectRow("Main"); // measure with nothing selected, so the selection tint doesn't colour the mesh
  await sleep(300);
  const plainColors = await viewportColors();
  await selectRow("MeshInstance3D");
  // (The viewport's own axes lines are pure red / green / blue, so an untextured scene already has a few; compare with that.)
  await importPng(`${work}/quadrants.png`);
  await waitText('Imported texture "quadrants" (16 x 16, 512 bytes of texture memory) onto "MeshInstance3D"');
  f = await textureField();
  assert.equal(f.select.selected, "quadrants (16 x 16)");
  assert.deepEqual(f.select.options, ["None", "quadrants (16 x 16)"]);
  assert.ok(await isDirty());
  await selectRow("Main"); // deselect so the selection tint doesn't touch the colors
  await sleep(300);
  const textured = await viewportColors();
  for (const color of ["red", "green", "blue", "yellow"]) assert.ok(textured[color] > plainColors[color] + 40, `the viewport draws ${color} (${plainColors[color]} -> ${textured[color]} pixels)`);
  pass(`importing quadrants.png textures the mesh and the viewport draws its four colors (${textured.red} red, ${textured.green} green, ${textured.blue} blue, ${textured.yellow} yellow pixels)`);
  await selectRow("MeshInstance3D");

  // ---- The Hardware tab counts texture memory; sharing a texture counts it once.
  assert.deepEqual(await textureBytes(), { used: 512, limit: 524288 });
  await bottomTab("Output");
  await selectRow("Main");
  await addNode("MeshInstance3D");
  await setVector("Position", [2, 0, 0]);
  await chooseTexture("quadrants");
  assert.deepEqual(await textureBytes(), { used: 512, limit: 524288 }, "two meshes sharing one texture cost it once");
  await importPng(`${work}/checker32.png`);
  assert.equal((await textureField()).select.selected, "checker32 (32 x 32)");
  assert.deepEqual(await textureBytes(), { used: 512 + 2048, limit: 524288 }, "a second texture adds its own 2048");
  pass("the Hardware tab counts texture memory by distinct texture (512, then 512 + 2048 of 524288)");

  // ---- Partly transparent pixels are reported.
  await bottomTab("Output");
  await importPng(`${work}/soft-edges.png`);
  assert.match(await body(), /Warning: 8 pixels are partly transparent/);
  await chord("z"); // and that import is undoable
  assert.equal((await textureField()).select.selected, "checker32 (32 x 32)");
  pass("partly transparent pixels are reported as a warning, and that import undoes cleanly");

  // ---- Switching and clearing.
  await chooseTexture("None");
  assert.equal((await textureField()).select.selected, "None");
  await chooseTexture("quadrants");
  assert.equal((await textureField()).select.selected, "quadrants (16 x 16)");
  pass("a mesh can switch between the project's textures and back to None");

  // ---- Undo of the first import takes the texture out of the project.
  await saveProject();
  const saved = readProject();
  // By now both meshes use "quadrants": "checker32" was imported but nothing uses it any more, and "soft-edges" was undone.
  assert.equal(saved.textures.length, 1, "the file has only the texture the meshes use");
  assert.equal(saved.textures[0].name, "quadrants");
  const users = [];
  (function walk(n) { if (n.mesh?.textureId) users.push(n.mesh.textureId); n.children.forEach(walk); })(saved.scene);
  assert.deepEqual(users, [saved.textures[0].id, saved.textures[0].id], "both meshes refer to the one shared copy");
  const quad = saved.textures.find((t) => t.name === "quadrants");
  assert.equal(quad.width, 16);
  assert.equal(Buffer.from(quad.texels, "base64").length, 16 * 16 * 2, "2 bytes a pixel");
  const texels = Buffer.from(quad.texels, "base64");
  assert.equal(texels.readUInt16LE(0), 0x8000 | 31, "the top-left texel is opaque red");
  assert.equal(texels.readUInt16LE(15 * 2), 0x8000 | (31 << 5), "the top-right is green");
  assert.equal(texels.readUInt16LE(15 * 16 * 2), 0x8000 | (31 << 10), "the bottom-left is blue");
  assert.equal(texels.readUInt16LE(255 * 2), 0x8000 | 31 | (31 << 5), "and the bottom-right is yellow");
  pass("saving embeds a shared texture once (dropping the unused ones), in DS format, with the right texels in the right corners");

  // ---- Closed and reopened: still textured.
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await answerOpen(PROJECT_PATH);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  await selectRow("MeshInstance3D");
  assert.equal((await textureField()).select.selected, "quadrants (16 x 16)");
  assert.deepEqual(await textureBytes(), { used: 512, limit: 524288 });
  await bottomTab("Output");
  await selectRow("Main");
  await sleep(300);
  const reopenedColors = await viewportColors();
  assert.ok(reopenedColors.yellow > 40 && reopenedColors.green > plainColors.green + 40, "the reopened viewport still draws the picture");
  pass("the textures survive closing and reopening, and are drawn");

  // ---- Undo and redo of an import, and the saved file follows.
  await selectRow("MeshInstance3D");
  await importPng(`${work}/quadrants.png`); // a second copy of the same picture, as a new texture
  assert.ok((await textureField()).select.options.filter((o) => o.startsWith("quadrants")).length === 2);
  await chord("z");
  assert.equal((await textureField()).select.options.filter((o) => o.startsWith("quadrants")).length, 1, "Ctrl+Z took the imported texture out of the project");
  await saveProject();
  assert.equal(readProject().textures.length, 1, "the undone texture isn't in the file");
  await chord("z", { shift: true });
  assert.equal((await textureField()).select.options.filter((o) => o.startsWith("quadrants")).length, 2, "Ctrl+Shift+Z put it back");
  await chord("z");
  pass("importing a texture is undoable and redoable (Ctrl+Z / Ctrl+Shift+Z)");

  // ---- Models: no UVs means no texture; UVs mean a texture works.
  await selectRow("Main");
  await answerOpen(HOUSE);
  await menu("Scene");
  await click("Import Model (.obj)...");
  await waitText('Imported model "house"');
  f = await textureField();
  assert.equal(f.select.disabled, true, "a model with no UVs can't take a texture");
  assert.deepEqual(f.button, { disabled: true });
  assert.ok(f.note, "and says why");
  await selectRow("Main");
  await answerOpen(`${work}/quad-uv.obj`);
  await menu("Scene");
  await click("Import Model (.obj)...");
  await waitText('Imported model "quad-uv"');
  f = await textureField();
  assert.equal(f.select.disabled, false, "a model with UVs can");
  await chooseTexture("quadrants");
  assert.equal((await textureField()).select.selected, "quadrants (16 x 16)");
  await chooseMeshSource("house");
  f = await textureField();
  assert.equal(f.select.selected, "None", "switching a textured mesh to a model without UVs cleared its texture");
  assert.equal(f.select.disabled, true);
  await chord("z");
  assert.equal((await textureField()).select.selected, "quadrants (16 x 16)", "and one Ctrl+Z restores both the model and the texture");
  pass("a model without UVs can't be textured (and says why); one with UVs can; switching to one without clears the texture, undoably");

  // ---- Export a real ROM from the project.
  await bottomTab("Output");
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 90000);
  const rom = readFileSync(ROM_PATH);
  assert.equal(rom.subarray(0, 8).toString(), "HOMEBREW");
  assert.ok(rom.length > 100 * 1024);
  pass("Export ROM builds a valid .nds from the textured project");

  // ---- Unused textures aren't saved.
  await selectRow("Main");
  for (const name of (await rowNames()).filter((n) => n !== "Main" && n !== "Camera3D")) {
    await selectRow(name);
    await menu("Scene");
    await click("Delete Node");
    await sleep(200);
  }
  await saveProject();
  assert.ok(!("textures" in readProject()), "with no mesh using them, the textures aren't in the file");
  pass("textures no mesh uses are dropped from the file on save");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "texture-mesh-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
