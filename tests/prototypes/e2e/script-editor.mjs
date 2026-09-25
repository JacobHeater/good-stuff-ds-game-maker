// Prototype E2E for scripting in the editor (requirements/scripting/TASK.script-editor-and-attachment.md, STORY.write-and-run-scripts.md).
// Drives the built Electron app over CDP with real typing, pasting and clicks, and stubs only the native file dialogs: the Script tab and its
// code editor (CodeMirror), errors underlined and listed as they are typed, attaching from the Inspector, rename, delete, undo, save and
// reopen, and a real Export ROM from a project whose script is first broken and then fixed.
//
//   pnpm build && node tests/prototypes/e2e/script-editor.mjs
//
// Needs tools/ds-toolchain for the final export. Uses ports 9333 and 9229; close other instances first.
// It prints `SAVED <path>`; GSDS_SCRIPT_ROM_PROJECT=<path> pnpm test:rom then compiles that project, runs it in melonDS and checks that the
// script moved the mesh where the equivalent static scene has it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-script-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/scripted.gsds`;
const ROM_PATH = `${work}/scripted.nds`;
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
const tab = async (name) => { await click(name, { within: "" }); await sleep(300); };

// ---- The code editor.
const editorLines = () => page.evaluate(() => [...document.querySelectorAll(".cm-line")].map((l) => l.textContent));
const editorText = async () => (await editorLines()).join("\n");
/** Replaces the whole text the way a paste does (exact, with no auto-indent). */
async function pasteSource(text) {
  await page.evaluate(() => document.querySelector(".cm-content").focus());
  await chord("a");
  await page.evaluate((text) => {
    const el = document.querySelector(".cm-content");
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await sleep(700); // the checker runs a moment after typing stops
}
const problems = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=script-problems] button")].map((b) => ({
  severity: b.dataset.severity,
  where: b.children[1].textContent.trim(),
  message: b.children[2].textContent.trim()
})));
const problemsHeading = () => page.evaluate(() => document.querySelector("[data-testid=script-problems]").firstElementChild.textContent.trim());
const scriptList = () => page.evaluate(() => [...document.querySelectorAll("[role=listbox][aria-label=Scripts] [role=option]")].map((o) => ({ name: o.children[0].textContent.trim(), used: Number(o.children[1].textContent), selected: o.getAttribute("aria-selected") === "true" })));
const inspectorScript = () => page.evaluate(() => {
  const select = document.querySelector("[data-testid=script-field] select");
  return select ? { selected: select.selectedOptions[0].textContent.trim(), options: [...select.options].map((o) => o.textContent.trim()) } : null;
});
const chooseInspectorScript = async (label) => {
  await page.evaluate((label) => {
    const select = document.querySelector("[data-testid=script-field] select");
    const option = [...select.options].find((o) => o.textContent.trim() === label);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, label);
  await sleep(250);
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
  await installDialogs();
  await waitText("New Project");
  await answerSave(PROJECT_PATH);
  await click("New Project");
  await page.type("input[type=text]", "Scripted");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- The Script tab starts empty, and a script is created.
  await tab("Script");
  await waitText("This project has no scripts yet.");
  assert.deepEqual(await scriptList(), []);
  await click("New Script", { within: "[data-testid=script-workspace] > div, [data-testid=script-workspace]" });
  await sleep(500);
  assert.deepEqual(await scriptList(), [{ name: "Script", used: 0, selected: true }]);
  assert.equal(await editorText(), "func _ready():\n    pass\n\nfunc _process(delta):\n    pass\n", "a new script starts with the stubs");
  assert.ok(await isDirty(), "a new script is an unsaved change");
  assert.match(await body(), /Not attached to any node\./);
  pass("the Script tab starts empty; New Script creates a script with the _ready and _process stubs, unattached and unsaved");

  // ---- Typing: Enter indents after a colon, Tab inserts four spaces.
  await pasteSource("");
  await page.keyboard.type("func f():");
  await page.keyboard.press("Enter");
  await page.keyboard.type("var a = 1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("if a == 1:");
  await page.keyboard.press("Enter");
  await page.keyboard.type("pass");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("x");
  await sleep(300);
  assert.deepEqual(await editorLines(), ["func f():", "    var a = 1", "    if a == 1:", "        pass", "            x"], "Enter keeps the indentation and adds a level after a colon; Tab is four spaces");
  pass("real typing: Enter keeps the indentation and adds a level after a colon, and Tab inserts four spaces");

  // ---- Mistakes are underlined and listed with line and column, as they are typed.
  await pasteSource(`var speed = 2.0

func _ready():
    var a: int = 2.5
    $Missing.visible = true
    nope()

func _process(delta):
    var unused = 1
`);
  const found = await problems();
  assert.deepEqual(found.filter((p) => p.severity === "error").map((p) => p.where), ["4:18", "5:5", "6:5"]);
  assert.match(found.find((p) => p.where === "4:18").message, /A float can't go into an int without losing its fraction; use int\(x\)/);
  assert.match(found.find((p) => p.where === "5:5").message, /There is no node named "Missing" in the scene\./);
  assert.match(found.find((p) => p.where === "6:5").message, /Unknown function "nope"/);
  assert.deepEqual(found.filter((p) => p.severity === "warning").map((p) => p.where), ["4:9", "9:9"], JSON.stringify(found));
  assert.equal(await problemsHeading(), "Problems (3 errors, 2 warnings)");
  const underlined = await page.evaluate(() => ({ errors: document.querySelectorAll(".cm-lintRange-error").length, warnings: document.querySelectorAll(".cm-lintRange-warning").length }));
  assert.ok(underlined.errors >= 3 && underlined.warnings >= 1, `errors and warnings are underlined in the editor (${JSON.stringify(underlined)})`);
  pass("mistakes are underlined in the editor and listed with line:column and a message (3 errors and 2 warnings), with no build");

  // ---- Clicking a problem moves the cursor to it.
  await page.evaluate(() => [...document.querySelectorAll("[data-testid=script-problems] button")].find((b) => b.children[1].textContent.trim() === "6:5").click());
  await sleep(300);
  assert.equal(await page.evaluate(() => document.querySelector(".cm-activeLine")?.textContent), "    nope()");
  assert.equal(await page.evaluate(() => document.activeElement?.closest(".cm-editor") !== null), true, "and focuses the editor");
  pass("clicking a problem puts the cursor on its line and focuses the editor");

  // ---- Diagnostics follow the scene: $Player resolves once a node with that name exists.
  await pasteSource("func _process(delta):\n    $AudioStreamPlayer.play()\n");
  assert.match((await problems())[0].message, /There is no node named "AudioStreamPlayer" in the scene\./);
  await tab("3D");
  await addNode("AudioStreamPlayer");
  await tab("Script");
  await sleep(700);
  assert.deepEqual(await problems(), [], "with the node added, $AudioStreamPlayer resolves");
  await tab("3D");
  await menu("Scene");
  await click("Delete Node");
  await sleep(250);
  await tab("Script");
  await sleep(700);
  assert.equal((await problems()).length, 1, "and deleting it brings the error back");
  pass("the errors follow the scene: $AudioStreamPlayer is an error, then fine when a node has that name, then an error again once it is deleted");

  // ---- Attach from the Inspector.
  await pasteSource("var speed = 2.0\n\nfunc _process(delta):\n    position.x += speed * delta\n");
  assert.deepEqual(await problems(), []);
  await tab("3D");
  await selectRow("Main");
  await addNode("MeshInstance3D");
  assert.deepEqual(await inspectorScript(), { selected: "None", options: ["None", "Script"] });
  await chooseInspectorScript("Script");
  assert.equal((await inspectorScript()).selected, "Script");
  await tab("Script");
  assert.deepEqual(await scriptList(), [{ name: "Script", used: 1, selected: true }]);
  assert.match(await body(), /Attached to MeshInstance3D\./);
  pass("the Inspector lists the project's scripts; choosing one attaches it (the Script tab shows who uses it)");

  // ---- Members depend on the node it is attached to; a script on a light can't write play().
  await pasteSource("func _ready():\n    play()\n");
  assert.match((await problems())[0].message, /"play" isn't available on MeshInstance3D \(a MeshInstance3D\), and this script is attached to it\./);
  await pasteSource("var speed = 2.0\n\nfunc _process(delta):\n    position.x += speed * delta\n");
  assert.deepEqual(await problems(), []);
  pass("a script is checked against the kind of node it is attached to (play() on a mesh is an error naming the node)");

  // ---- Rename, and a second script from the Inspector's New Script.
  await page.focus("input[aria-label='Script name']"); await page.evaluate(() => document.activeElement.select());
  await page.keyboard.type("Player");
  await sleep(300);
  assert.deepEqual((await scriptList()).map((s) => s.name), ["Player"]);
  await tab("3D");
  await addNode("Camera3D");
  await click("New Script", { within: "[data-testid=script-field]" });
  await sleep(500);
  assert.equal((await inspectorScript()).selected, "Script");
  await tab("Script");
  assert.deepEqual((await scriptList()).map((s) => [s.name, s.used, s.selected]), [["Player", 1, false], ["Script", 1, true]]);
  pass("rename changes the name everywhere; the Inspector's New Script creates a script, attaches it to that node and selects it in the Script tab");

  // ---- Edit opens the Script tab on the node's script.
  await tab("3D");
  await selectRow("MeshInstance3D");
  await click("Edit", { within: "[data-testid=script-field]" });
  await sleep(400);
  assert.equal((await scriptList()).find((s) => s.selected).name, "Player");
  assert.match(await editorText(), /position\.x \+= speed \* delta/);
  pass("Edit in the Inspector opens the Script tab with that node's script selected");

  // ---- Undo: outside the code editor it undoes the scene edit; inside, Ctrl+Z is the editor's own.
  await tab("3D");
  await selectRow("Camera3D");
  await chooseInspectorScript("None");
  assert.equal((await inspectorScript()).selected, "None");
  await blurFocus();
  await chord("z");
  assert.equal((await inspectorScript()).selected, "Script", "Ctrl+Z (outside the code editor) undid the detach");
  await chord("z", { shift: true });
  assert.equal((await inspectorScript()).selected, "None", "and Ctrl+Shift+Z redid it");
  await chord("z");
  await tab("Script");
  await page.click(".cm-content");
  await page.keyboard.press("End");
  await page.keyboard.type("# typed");
  await sleep(400);
  assert.match(await editorText(), /# typed/);
  await chord("z");
  assert.doesNotMatch(await editorText(), /# typed/, "Ctrl+Z inside the code editor undid the typing");
  assert.ok((await scriptList()).length === 2, "and the scene's history wasn't touched");
  pass("Ctrl+Z outside the code editor undoes scene edits (attach/detach); inside it is the editor's own text undo");

  // ---- Delete asks first, detaches the nodes, and a cancelled delete does nothing.
  await click("Delete Script");
  assert.match(await body(), /Delete it\? 1 node will have no script\./);
  await click("Cancel");
  assert.equal((await scriptList()).length, 2);
  await click("Delete Script");
  await click("Delete", { within: "[data-testid=script-workspace]" });
  await sleep(400);
  assert.deepEqual((await scriptList()).map((s) => s.name), ["Script"]);
  await tab("3D");
  await selectRow("MeshInstance3D");
  assert.equal((await inspectorScript()).selected, "None", "the node that used the deleted script has none");
  await blurFocus();
  await chord("z");
  await selectRow("MeshInstance3D");
  assert.deepEqual((await inspectorScript()).options, ["None", "Player", "Script"], "undo brings the script back");
  assert.equal((await inspectorScript()).selected, "Player", "and re-attaches it");
  pass("Delete Script asks first (Cancel does nothing), detaches every node that used it, and one Ctrl+Z restores script and attachment");

  // ---- Save and reopen: sources, names and attachments come back; an unattached script is kept.
  await selectRow("Camera3D");
  await chooseInspectorScript("None");
  await tab("Script");
  await page.evaluate(() => [...document.querySelectorAll("[role=listbox][aria-label=Scripts] [role=option]")].find((o) => o.textContent.startsWith("Script")).click());
  await pasteSource("# an unattached script with é and a tab\n\tvar x = 1\n");
  await tab("3D");
  await saveProject();
  const saved = readProject();
  assert.equal(saved.scripts.length, 2);
  assert.deepEqual(saved.scripts.map((s) => s.name).sort(), ["Player", "Script"]);
  const player = saved.scripts.find((s) => s.name === "Player");
  assert.equal(player.source, "var speed = 2.0\n\nfunc _process(delta):\n    position.x += speed * delta\n");
  assert.equal(saved.scripts.find((s) => s.name === "Script").source, "# an unattached script with é and a tab\n\tvar x = 1\n");
  const meshNode = saved.scene.children.find((c) => c.kind === "MeshInstance3D");
  assert.equal(meshNode.scriptId, player.id);
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await answerOpen(PROJECT_PATH);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  await selectRow("MeshInstance3D");
  assert.equal((await inspectorScript()).selected, "Player");
  await tab("Script");
  assert.deepEqual((await scriptList()).map((s) => [s.name, s.used]), [["Player", 1], ["Script", 0]]);
  assert.ok(!(await isDirty()), "reopened clean");
  pass("saving writes each script's exact text and the attachments (an unattached script is kept); reopening shows them all again, clean");

  // ---- Export ROM: a project with a broken script is refused with the script, line and column; the fixed one builds.
  await tab("3D");
  // A scene that can be photographed: drop the camera that sits inside the mesh, and put a camera in front of it under the root.
  await selectRow("Camera3D");
  await menu("Scene");
  await click("Delete Node");
  await sleep(250);
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 0, 6]);
  await tab("Script");
  await page.evaluate(() => [...document.querySelectorAll("[role=listbox][aria-label=Scripts] [role=option]")].find((o) => o.textContent.startsWith("Player")).click());
  await pasteSource("func _ready():\n    position.x = 1.5\n    var oops: int = 0.5\n");
  await tab("3D");
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Error [Player script]: line 3, column 21", 60000);
  assert.ok(!existsSync(ROM_PATH), "no ROM was written");
  pass("Export ROM refuses a project whose script has an error, naming the script, line and column, and writes no ROM");

  await tab("Script");
  await pasteSource("func _ready():\n    position.x = 1.2\n    position.y = 0.4\n");
  assert.deepEqual(await problems(), []);
  await tab("3D");
  await selectRow("MeshInstance3D");
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 120000);
  assert.equal(readFileSync(ROM_PATH).subarray(0, 8).toString(), "HOMEBREW");
  await saveProject();
  console.log(`SAVED ${PROJECT_PATH}`);
  pass("with the script fixed, Export ROM builds a real .nds");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "script-editor-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
