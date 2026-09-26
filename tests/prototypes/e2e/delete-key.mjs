// Prototype E2E for deleting the selected node with the Delete or Backspace key. Drives the built Electron app over CDP with real
// key presses (no dialogs are needed except the New Project location, which is stubbed).
//
//   pnpm build && node tests/prototypes/e2e/delete-key.mjs
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
const work = mkdtempSync(join(tmpdir(), "gsds-delkey-")).replace(/\\/g, "/");
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
const addNode = async (kind) => { await click("Scene"); await sleep(150); await click(kind, { endsWith: true }); await sleep(250); };
const rowNames = () => page.evaluate(() => [...document.querySelectorAll("[role=button]")].map((r) => r.querySelector("span.flex-1")?.textContent.trim()).filter(Boolean));
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(150);
};
const press = async (key) => { await page.keyboard.press(key); await sleep(250); };
const undo = async () => { await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control"); await sleep(250); };
const blurFocus = () => page.evaluate(() => document.activeElement?.blur?.());

try {
  await waitFor("http://127.0.0.1:9333/json/version");
  await waitFor("http://127.0.0.1:9229/json");
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9333", defaultViewport: null });
  for (let i = 0; i < 40 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes("index.html"));
    if (!page) await sleep(500);
  }
  page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });
  await mainEval(`(() => { const req = (process.mainModule && process.mainModule.require) || require; req("electron").dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(work + "/d.gsds")} }); return 1; })()`);
  await waitText("New Project");
  await click("New Project");
  await page.type("input[type=text]", "Delete");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("2D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- Delete removes the selected node; undo brings it back.
  await addNode("Sprite2D");
  await selectRow("Main"); // a new node goes under the selected one
  await addNode("Label");
  assert.deepEqual(await rowNames(), ["Main", "Sprite2D", "Label"]);
  await selectRow("Sprite2D");
  await press("Delete");
  assert.deepEqual(await rowNames(), ["Main", "Label"], "Delete removed the selected node");
  assert.match(await body(), /Unsaved changes/);
  await undo();
  assert.deepEqual(await rowNames(), ["Main", "Sprite2D", "Label"], "one undo brings it back");
  pass("Delete removes the selected node, and Ctrl+Z restores it");

  // ---- Backspace does the same.
  await selectRow("Label");
  await press("Backspace");
  assert.deepEqual(await rowNames(), ["Main", "Sprite2D"], "Backspace removed the selected node");
  await undo();
  assert.deepEqual(await rowNames(), ["Main", "Sprite2D", "Label"]);
  pass("Backspace removes the selected node too");

  // ---- Typing keeps the key: Backspace in the Name field edits the text and deletes nothing.
  await selectRow("Sprite2D");
  await page.click("input[aria-label=Name]");
  await press("Backspace");
  await press("Delete");
  assert.equal((await rowNames()).length, 3, "no node was deleted while a field had focus");
  assert.equal(await page.$eval("input[aria-label=Name]", (i) => i.value), "Sprite2", "the field handled its own Backspace (one letter removed)");
  await blurFocus();
  await undo(); // the Backspace in the Name field was a rename edit
  pass("Backspace and Delete in the Name field edit the text and delete no node");

  // ---- The scene root can't be deleted, and nothing happens.
  await selectRow("Main");
  await press("Delete");
  await press("Backspace");
  assert.equal((await rowNames()).length, 3, "the root stays");
  pass("Delete on the scene root does nothing");

  // ---- Modifier chords are not deletion (Ctrl+Backspace, Shift+Delete).
  await selectRow("Label");
  await page.keyboard.down("Control"); await page.keyboard.press("Backspace"); await page.keyboard.up("Control"); await sleep(250);
  await page.keyboard.down("Shift"); await page.keyboard.press("Delete"); await page.keyboard.up("Shift"); await sleep(250);
  assert.equal((await rowNames()).length, 3, "chords delete nothing");
  pass("Ctrl+Backspace and Shift+Delete do not delete");

  // ---- Not on the Script tab.
  await click("Script");
  await sleep(300);
  await blurFocus();
  await press("Delete");
  await click("2D");
  await sleep(300);
  assert.equal((await rowNames()).length, 3, "the Script tab ignores Delete");
  pass("Delete does nothing on the Script tab");

  // ---- The menu shows the shortcut, and still works.
  await click("Scene");
  await sleep(150);
  assert.equal(await page.$eval("button[aria-keyshortcuts=Del]", (b) => b.textContent.trim()), "Delete Node", "the menu item advertises Del");
  await click("Delete Node", { endsWith: false }).catch(async () => {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Delete Node")).click());
  });
  await sleep(250);
  assert.equal((await rowNames()).length, 2, "Scene > Delete Node still deletes the selection");
  pass("Scene > Delete Node shows the Del shortcut and still works");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "delete-key-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
