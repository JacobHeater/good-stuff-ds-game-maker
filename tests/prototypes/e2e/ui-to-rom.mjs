// Prototype: author a 3D scene through the REAL editor UI, save it, and print the path of the saved project.
// The saved project is then compiled and checked against the emulator by the ROM tests:
//
//   pnpm build                                   (the app)
//   node tests/prototypes/e2e/ui-to-rom.mjs      (prints "SAVED <path>")
//   GSDS_ROM_PROJECT=<path> pnpm test:rom        (compile it, run it in melonDS, compare with the reference)
//
// Same technique as e2e.mjs: drive the built Electron app over CDP and stub only the native file dialogs.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const work = mkdtempSync(join(tmpdir(), "gsds-ui-scene-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/ui-scene.gsds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(`${DESKTOP}/node_modules/electron/dist/electron.exe`, [".", "--remote-debugging-port=9333", "--inspect=9229", `--user-data-dir=${work}/userdata`], {
  cwd: DESKTOP, env, stdio: "ignore"
});

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
const waitText = (text, timeout = 8000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const menu = async (name) => { await click(name); await sleep(150); };
const addNode = async (kind) => { await menu("Scene"); await click(kind, { endsWith: true }); await sleep(250); };
const selectRow = (name) => page.evaluate((name) => {
  const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
  if (!row) throw new Error(`no scene tree row "${name}"`);
  row.click();
}, name);

/** Sets the X/Y/Z inputs of an Inspector vector field ("Position", "Rotation (deg)" or "Scale"). */
async function setVector(label, [x, y, z]) {
  await page.evaluate((label, values) => {
    const heading = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === label && d.className.includes("text-[11px]"));
    if (!heading) throw new Error(`no Inspector field "${label}"`);
    const inputs = [...heading.nextElementSibling.querySelectorAll("input")];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    inputs.forEach((input, i) => {
      setter.call(input, String(values[i]));
      input.dispatchEvent(new Event("input", { bubbles: true })); // React listens for input, not a plain value change
    });
  }, label, [x, y, z]);
  await sleep(120);
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
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(PROJECT_PATH)} });
    return "ok";
  })()`);

  // A new 3D project.
  await waitText("New Project");
  await click("New Project");
  await page.type("input[type=text]", "UI Scene");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // A cube. Adding a node puts it under the selection and selects it.
  await addNode("MeshInstance3D");
  await setVector("Position", [-1.2, 0.5, 0]);
  await setVector("Rotation (deg)", [0, 25, 0]);

  // A second cube added while the first is selected, so it nests under it: its position is relative to the first.
  await addNode("MeshInstance3D");
  await setVector("Position", [2, 0, 0]);
  await setVector("Scale", [0.6, 0.6, 0.6]);
  await setVector("Rotation (deg)", [0, 0, 40]);

  // Camera and light go under the scene root.
  await selectRow("Main");
  await addNode("Camera3D");
  await setVector("Position", [0, 3, 7]);
  await setVector("Rotation (deg)", [-23, 0, 0]);

  await selectRow("Main");
  await addNode("DirectionalLight3D");
  await setVector("Rotation (deg)", [-50, 30, 0]);

  await page.screenshot({ path: join(HERE, "ui-scene-editor.png") });

  await menu("Project");
  await click("Save Project");
  await waitText("Saved project to");
  console.log(`SAVED ${PROJECT_PATH}`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "ui-scene-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
}
