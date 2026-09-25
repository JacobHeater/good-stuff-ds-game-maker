// Prototype E2E for auto-complete in the script editor (requirements/scripting/TASK.script-autocomplete.md). Drives the built Electron app over CDP with real
// key presses: a 3D project with a mesh, a sound player and an animation player, then a script typed into the Script tab with the suggestion pop-up used for
// node names after `$`, members after a dot, `Input.is_button_down("`, the script's own variables, and left alone in comments.
//
//   pnpm build && node tests/prototypes/e2e/script-autocomplete.mjs
//
// Uses ports 9333 and 9229; close other instances first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-autocomplete-e2e-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/autocomplete.gsds`;
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

let page;
const click = (label, { endsWith = false, within = "" } = {}) => page.evaluate((label, endsWith, within) => {
  const scope = within ? document.querySelector(within) : document;
  const b = [...scope.querySelectorAll("button")].find((x) => (endsWith ? x.textContent.trim().endsWith(label) : x.textContent.trim() === label));
  if (!b) throw new Error(`no button "${label}"${within ? ` in ${within}` : ""}`);
  b.click();
}, label, endsWith, within);
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const tab = async (name) => { await click(name); await sleep(300); };

// ---- The editor and its pop-up.
const editorText = () => page.evaluate(() => [...document.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"));
const problems = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=script-problems] button")].map((b) => ({ severity: b.dataset.severity, where: b.children[1].textContent.trim(), message: b.children[2].textContent.trim() })));
/** What the pop-up shows: [{ label, detail }] in order, or null when it is not open. */
const popup = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll(".cm-tooltip-autocomplete li")];
  if (rows.length === 0) return null;
  return rows.map((row) => ({ label: row.querySelector(".cm-completionLabel")?.textContent ?? "", detail: row.querySelector(".cm-completionDetail")?.textContent ?? "" }));
});
async function waitPopup(timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const list = await popup();
    if (list) {
      await sleep(250); // the editor ignores Enter and Tab for a moment after the list changes, so a key press isn't taken by mistake
      return (await popup()) ?? list;
    }
    await sleep(60);
  }
  throw new Error(`no auto-complete pop-up; the editor says:\n${await editorText()}`);
}
async function expectNoPopup(why) {
  await sleep(450);
  assert.equal(await popup(), null, `no pop-up ${why}`);
}
const type = async (text) => { await page.keyboard.type(text, { delay: 25 }); await sleep(120); };
const press = async (key) => { await page.keyboard.press(key); await sleep(150); };
const lastLine = async () => (await editorText()).split("\n").at(-1);
const labels = (list) => list.map((row) => row.label);
async function chord(key) {
  await page.keyboard.down("Control");
  await page.keyboard.press(key);
  await page.keyboard.up("Control");
  await sleep(200);
}
async function pasteSource(text) {
  await page.evaluate(() => document.querySelector(".cm-content").focus());
  await chord("a");
  await page.evaluate((text) => {
    const el = document.querySelector(".cm-content");
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
  await sleep(500);
  await chord("End"); // (Ctrl+End: the end of the text)
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
  await page.type("input[type=text]", "Autocomplete");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");
  await tab("3D");
  await addNode("MeshInstance3D");
  await addNode("AudioStreamPlayer");
  await addNode("AnimationPlayer");
  pass("a project with a mesh, a sound player and an animation player");

  await tab("Script");
  await click("New Script", { within: "[data-testid=script-workspace]" });
  await sleep(500);
  await pasteSource("var speed = 2.0\n\nfunc _process(delta):\n    ");
  assert.equal(await lastLine(), "    ");

  // ---- Node names after $.
  await type("$");
  let list = await waitPopup();
  assert.deepEqual(labels(list), ["$AnimationPlayer", "$AudioStreamPlayer", "$Main", "$MeshInstance3D"], JSON.stringify(list));
  assert.ok(list.find((row) => row.label === "$MeshInstance3D").detail.includes("MeshInstance3D"), "each node is listed with its kind");
  pass('"$" lists the scene\'s nodes, each with its kind');

  await type("Aud");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["$AudioStreamPlayer"], "typing narrows the list");
  await press("Enter");
  assert.equal(await lastLine(), "    $AudioStreamPlayer", "Enter takes the suggestion instead of making a new line");
  await expectNoPopup("after choosing");
  pass("typing narrows the list and Enter inserts the choice");

  // ---- Members follow the kind.
  await type(".");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["volume", "pitch", "play", "stop"], "a sound player has volume, pitch, play and stop (and no position)");
  await type("vo");
  await press("Enter");
  assert.equal(await lastLine(), "    $AudioStreamPlayer.volume");
  await type(" = 50.0");
  await expectNoPopup("after a number");
  await press("Enter");
  assert.equal(await lastLine(), "    ", "with the pop-up closed Enter makes a new line at the same indentation");
  pass('"." lists what a sound player has; volume is chosen and the line goes on as usual');

  // ---- Input and the buttons.
  await type("if Input.is_b");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["is_button_down", "is_button_pressed", "is_button_released"]);
  await press("Tab");
  assert.equal(await lastLine(), '    if Input.is_button_down("")', "Tab takes it, with the quotes and the cursor between them");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["a", "b", "x", "y", "l", "r", "start", "select", "up", "down", "left", "right"], "the list opens again with the buttons");
  await type("le");
  await press("Enter");
  assert.equal(await lastLine(), '    if Input.is_button_down("left")', "the closing quote is not doubled");
  await press("End");
  await type(":");
  await press("Enter");
  assert.equal(await lastLine(), "        ", "a new block is indented");
  pass('Input.is_button_down(" offers the twelve buttons');

  // ---- A node's transform, and the script's own variable.
  await type("$Mesh");
  await waitPopup();
  await press("Enter");
  await type(".");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["position", "rotation", "scale", "visible"], "a mesh has no volume");
  await type("pos");
  await press("Enter");
  await type(".");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["x", "y", "z"]);
  await press("Enter");
  assert.equal(await lastLine(), "        $MeshInstance3D.position.x");
  await type(" += sp");
  list = await waitPopup();
  assert.ok(labels(list).includes("speed"), "the script's own variable is offered");
  assert.equal(list.find((row) => row.label === "speed").detail, "float");
  await press("Tab");
  await type(" * de");
  list = await waitPopup();
  assert.ok(labels(list).includes("delta"), "and the parameter of _process");
  await press("Tab");
  assert.equal(await lastLine(), "        $MeshInstance3D.position.x += speed * delta");
  pass("a mesh's position.x is written from the pop-ups, with the script's own speed and delta offered");

  // ---- The checker is happy with what was typed.
  await sleep(800);
  assert.deepEqual(await problems(), [], `no problems in ${JSON.stringify(await editorText())}`);
  assert.match(await editorText(), /\$AudioStreamPlayer\.volume = 50\.0/);
  pass("the script written with the help of the pop-ups has no problems");

  // ---- Quiet places and the keyboard.
  await press("Enter");
  await type("# $Mus");
  await expectNoPopup("in a comment");
  await press("Enter");
  await type("\"$Mus");
  await expectNoPopup("in a string that names nothing");
  await page.keyboard.down("Control");
  await page.keyboard.press("Space");
  await page.keyboard.up("Control");
  await expectNoPopup("in a string that names nothing, even when asked for");
  await press("Backspace"); await press("Backspace"); await press("Backspace"); await press("Backspace"); await press("Backspace");
  await page.keyboard.down("Control");
  await page.keyboard.press("Space");
  await page.keyboard.up("Control");
  list = await waitPopup();
  assert.ok(labels(list).includes("if") && labels(list).includes("clamp") && labels(list).includes("speed"), "Ctrl+Space lists everything that fits a new statement");
  await press("Escape");
  await sleep(200);
  assert.equal(await popup(), null, "Escape closes the list");
  pass("nothing in comments or plain strings; Ctrl+Space opens the list and Escape closes it");

  // ---- Animation names and function templates.
  await pasteSource("func _process(delta):\n    $AnimationPlayer");
  await type(".");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["play", "stop", "is_playing", "speed_scale"]);
  await type("pl");
  await press("Tab");
  assert.equal(await lastLine(), '    $AnimationPlayer.play("")');
  await sleep(500);
  await chord("a");
  await press("Backspace");
  await type("fu");
  list = await waitPopup();
  assert.deepEqual(labels(list), ["func _process(delta):", "func _ready():", "func"]);
  await press("Enter");
  assert.equal(await editorText(), "func _process(delta):\n    ", "a whole function is written for you");
  pass("an AnimationPlayer's play(\" is offered, and func _process(delta): is a suggestion at the left edge");

  console.log(`\n${checks} checks passed`);
} catch (error) {
  console.error("FAILED:", error);
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
