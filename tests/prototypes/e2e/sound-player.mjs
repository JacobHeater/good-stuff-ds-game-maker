// Prototype E2E for sound import and the audio player (requirements/audio/STORY.import-sound-and-audio-player.md).
// Drives the built Electron app over CDP and stubs only the native file dialogs. It writes real WAV files (good and bad),
// imports them through the real UI, and then MEASURES THE REAL AUDIO: while the editor's preview plays, the loudness of the
// editor's own audio output is read from Windows' per-application peak meter (tools/ds-toolchain/measure-melonds-audio.ps1),
// so volume, pitch (as duration), loop and stopping are checked by what comes out of the speakers, not by what the UI says.
// It then saves, reopens, undoes, exports a real ROM and runs that in melonDS with the same meter.
//
//   pnpm build && node tests/prototypes/e2e/sound-player.mjs
//
// Needs tools/ds-toolchain, melonDS and a sound output device. Uses ports 9333 and 9229; close other instances first.
// Optional: GSDS_TEST_MP3=<path to any .mp3> also imports that file (the editor's decoder is the same for MP3 and OGG; no
// MP3 or OGG file is kept in the repo).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, "../../../apps/desktop").replace(/\\/g, "/");
const METER = join(HERE, "../../../tools/ds-toolchain/measure-melonds-audio.ps1");
const work = mkdtempSync(join(tmpdir(), "gsds-snd-")).replace(/\\/g, "/");
const PROJECT_PATH = `${work}/sound.gsds`;
const ROM_PATH = `${work}/sound.nds`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const pass = (name) => { checks++; console.log(`[PASS] ${name}`); };

// ---- Test sounds: real WAV files.
function wav(path, { channels = 1, rate, seconds, tones, amplitude = 0.5 }) {
  const frames = Math.round(rate * seconds);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) data.writeInt16LE(Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * tones[c] * i) / rate)), (i * channels + c) * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}
wav(`${work}/tone-mono-22k.wav`, { rate: 22050, seconds: 1.5, tones: [440] }); // 33075 samples = 66150 bytes
wav(`${work}/stereo-44k.wav`, { channels: 2, rate: 44100, seconds: 1, tones: [440, 880], amplitude: 0.4 }); // becomes 32000 samples at 32 kHz = 64000 bytes
wav(`${work}/too-big.wav`, { rate: 32000, seconds: 33, tones: [200] }); // 2,112,000 bytes: over the 2 MB budget: imported compressed to fit
wav(`${work}/too-long.wav`, { rate: 8000, seconds: 140, tones: [200] }); // 2,240,000 bytes: too long even at 8 kHz
writeFileSync(`${work}/bad.wav`, "this is not audio at all, just some words in a file");

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
const selectRow = async (name) => {
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll("[role=button]")].find((r) => r.querySelector("span.flex-1")?.textContent.trim() === name);
    if (!row) throw new Error(`no scene tree row "${name}"`);
    row.click();
  }, name);
  await sleep(200);
};
const isDirty = async () => (await body()).includes("Unsaved changes");
const bottomTab = async (name) => { await click(name); await sleep(150); };
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
  const startedSaving = Date.now();
  try {
    await page.waitForFunction(() => !document.body.innerText.includes("Unsaved changes"), { timeout: 30000 });
  } catch (error) {
    const text = await page.evaluate(() => document.body.innerText);
    console.log(`  save never finished; page text: ${text.replace(/\s+/g, " ").slice(0, 600)}`);
    throw error;
  }
  if (Date.now() - startedSaving > 2000) console.log(`  (saving took ${((Date.now() - startedSaving) / 1000).toFixed(1)} s)`);
};
const readProject = () => JSON.parse(readFileSync(PROJECT_PATH, "utf8"));

// ---- The Inspector's audio player.
const audio = () => page.evaluate(() => {
  const root = document.querySelector("[data-testid=audio-player]");
  if (!root) return null;
  const select = root.querySelector("select[aria-label=Sound]");
  const input = (label) => root.querySelector(`input[aria-label="${label}"]`);
  const play = [...root.querySelectorAll("button")].find((b) => ["Play", "Stop"].includes(b.textContent.trim()));
  return {
    sound: select.selectedOptions[0]?.textContent.trim(),
    options: [...select.options].map((o) => o.textContent.trim()),
    autoplay: input("Autoplay on load").checked,
    loop: input("Loop").checked,
    volume: Number(input("Volume").value),
    pitch: Number(input("Pitch").value),
    play: play.textContent.trim(),
    playDisabled: play.disabled,
    time: root.querySelector("[data-testid=audio-time]").textContent.trim(),
    importButton: [...root.querySelectorAll("button")].some((b) => b.textContent.trim() === "Import Sound..."),
    text: root.innerText
  };
});
const setRange = (label, value) => page.evaluate((label, value) => {
  const input = document.querySelector(`[data-testid=audio-player] input[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, label, value);
const clickCheckbox = (label) => page.evaluate((label) => document.querySelector(`[data-testid=audio-player] input[aria-label="${label}"]`).click(), label);
const clickPlay = () => page.evaluate(() => [...document.querySelectorAll("[data-testid=audio-player] button")].find((b) => ["Play", "Stop"].includes(b.textContent.trim())).click());
const importFromInspector = async (file) => { await answerOpen(`${work}/${file}`); await click("Import Sound..."); await sleep(900); };
const importFromMenu = async (file) => { await answerOpen(`${work}/${file}`); await menu("Scene"); await click("Import Sound..."); await sleep(900); };
const soundBytes = async () => {
  await bottomTab("Hardware");
  const m = /Sound memory\s*(\d+) \/ (\d+) bytes/.exec(await body());
  assert.ok(m, "the Hardware tab shows sound memory");
  return { used: Number(m[1]), limit: Number(m[2]) };
};

// ---- Measuring real audio.
/** Starts recording the editor's audio output; resolves (when it has run `seconds`) with the trace. */
function startMeter(rootPid, seconds) {
  const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", METER, "-RootPid", String(rootPid), "-Seconds", String(seconds)], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  return new Promise((resolve, reject) => child.on("close", () => {
    try { resolve(JSON.parse(out.trim().split("\n").pop().replace(/^﻿/, ""))); } catch (e) { reject(new Error(`the audio meter gave no result: ${out}`)); }
  }));
}
const SILENCE = 0.01;
/** What the trace shows between two wall-clock times: when sound began and ended, its typical level, its loudest peak. */
function summarize(trace, fromEpoch, toEpoch) {
  const inside = trace.samples.map(([t, p]) => [trace.startedAtEpochMs + t, p]).filter(([at]) => at >= fromEpoch && at <= toEpoch);
  const loud = inside.filter(([, p]) => p > SILENCE);
  if (loud.length === 0) return { heard: false, maxPeak: Math.max(0, ...inside.map(([, p]) => p)), seconds: 0, level: 0, onsetMs: null };
  const [first, last] = [loud[0][0], loud.at(-1)[0]];
  const middle = loud.filter(([at]) => at >= first + 150 && at <= last - 150).map(([, p]) => p).sort((a, b) => a - b);
  const pool = middle.length ? middle : loud.map(([, p]) => p).sort((a, b) => a - b);
  return { heard: true, maxPeak: Math.max(...inside.map(([, p]) => p)), seconds: (last - first) / 1000, level: pool[Math.floor(pool.length / 2)], onsetMs: first - fromEpoch };
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
  await page.type("input[type=text]", "Sound");
  await page.evaluate(() => [...document.querySelectorAll("button[role=radio]")].find((x) => x.textContent.startsWith("3D")).click());
  await click("Create Project…");
  await waitText("Scene Tree");

  // ---- The audio player is on an AudioStreamPlayer, and only there.
  assert.equal(await audio(), null, "the scene root has no audio player");
  await addNode("AudioStreamPlayer");
  let a = await audio();
  assert.ok(a, "an AudioStreamPlayer shows the audio player");
  assert.equal(a.sound, "None");
  assert.deepEqual(a.options, ["None"]);
  assert.ok(a.importButton);
  assert.deepEqual([a.autoplay, a.loop, a.volume, a.pitch], [true, false, 100, 1], "autoplay on, volume 100%, pitch 1, no loop");
  assert.ok(a.playDisabled, "nothing to play yet");
  assert.match(a.time, /^0:00 \/ 0:00$/);
  for (const kind of ["Camera3D", "DirectionalLight3D", "MeshInstance3D"]) {
    await selectRow("Main");
    await addNode(kind);
    assert.equal(await audio(), null, `${kind} shows no audio player`);
  }
  await selectRow("AudioStreamPlayer");
  pass("the Inspector shows the audio player (Sound None, Import Sound, autoplay on, volume 100%, pitch 1, loop off) on an AudioStreamPlayer only");

  // ---- Cancelling does nothing. (Save first, so "unedited" means something.)
  await saveProject();
  await answerOpen(null);
  await click("Import Sound...");
  await sleep(500);
  const call = (await openCalls()).at(-1);
  assert.equal(call.title, "Import Sound");
  assert.deepEqual(call.filters[0].extensions, ["wav", "mp3", "ogg"]);
  assert.ok(!(await isDirty()));
  assert.deepEqual((await audio()).options, ["None"]);
  pass("cancelling the file dialog changes nothing (and the dialog is filtered to wav, mp3, ogg)");

  // ---- Bad files are refused with a reason.
  await bottomTab("Output");
  await importFromInspector("bad.wav");
  let out = await body();
  assert.ok(out.includes('Could not import "bad.wav"'));
  assert.match(out, /"bad\.wav" isn't audio the editor can read.*WAV, MP3 and OGG files are supported/);
  await importFromInspector("too-long.wav");
  out = await body();
  assert.match(out, /Could not import "too-long\.wav"/);
  assert.match(out, /140\.0 seconds long\. The DS has 2 MB for all of a game's sounds, which holds at most 131 seconds even at 8000 Hz/);
  assert.deepEqual((await audio()).options, ["None"], "nothing was added");
  assert.ok(!(await isDirty()));
  pass("a file that isn't audio and a sound too long even at 8 kHz are each refused with a reason, adding nothing");

  // ---- A sound over the 2 MB budget is compressed more (resampled lower) to fit, rather than refused.
  const rowsBeforeFit = await rowNames();
  await importFromMenu("too-big.wav");
  out = await body();
  assert.match(out, /Warning: It is 33\.0 seconds long, more than the DS's 2 MB of sound memory holds at 32000 Hz, so it was resampled to 3177\d Hz to fit\. It will sound duller\./);
  assert.match(out, /Imported sound "too-big" \(0:33, 3177\d Hz, 20\d{5} bytes of sound memory\)/);
  const fitBytes = (await soundBytes()).used;
  assert.ok(fitBytes <= 2 * 1024 * 1024 && fitBytes > 2 * 1024 * 1024 - 2000, `it fills the budget without going over (${fitBytes})`);
  assert.match((await audio()).sound, /^too-big \(0:33, 3177\d Hz\)$/, "the player lists it at the new rate, still 33 s long");
  await bottomTab("Output");
  await blurFocus();
  await chord("z");
  assert.deepEqual(await rowNames(), rowsBeforeFit, "undo removes the player");
  assert.equal((await soundBytes()).used, 0, "and the sound");
  await bottomTab("Output");
  assert.ok(!(await isDirty()));
  pass("a 33 s sound over the 2 MB budget is resampled to 31.7 kHz to fit (and the log says so); undo removes it");

  // ---- Importing from the Inspector assigns the sound to the selected player; no new node.
  const rowsBefore = await rowNames();
  await importFromInspector("tone-mono-22k.wav");
  a = await audio();
  assert.equal(a.sound, "tone-mono-22k (0:01, 22050 Hz)");
  assert.deepEqual(await rowNames(), rowsBefore, "no new node");
  assert.ok(!a.playDisabled);
  assert.match(a.time, /^0:00 \/ 0:01$/);
  out = await body();
  assert.ok(out.includes('Imported sound "tone-mono-22k" (0:01, 22050 Hz, 66150 bytes of sound memory) onto "AudioStreamPlayer".'));
  assert.ok(await isDirty());
  pass("Import Sound... in the Inspector converts a WAV and assigns it to the selected player (no new node), and logs its length, rate and size");

  // ---- Scene > Import Sound... adds a new player; stereo 44.1 kHz is converted, and says so.
  await selectRow("Main");
  await importFromMenu("stereo-44k.wav");
  assert.ok((await rowNames()).includes("stereo-44k"), "a new player named after the file");
  a = await audio();
  assert.ok(a, "the new player is selected");
  assert.equal(a.sound, "stereo-44k (0:01, 32000 Hz)", "44.1 kHz stereo became 32 kHz mono");
  assert.deepEqual([a.autoplay, a.loop, a.volume, a.pitch], [true, false, 100, 1]);
  out = await body();
  assert.match(out, /Imported sound "stereo-44k" \(0:01, 32000 Hz, 64000 bytes of sound memory\) as node "stereo-44k"\./);
  assert.match(out, /Warning: It has 2 channels; the DS plays one, so they were mixed together\./);
  assert.match(out, /Warning: It is 44100 Hz; the DS plays up to about 32000 Hz, so it was resampled to 32000 Hz\./);
  assert.deepEqual(await soundBytes(), { used: 66150 + 64000, limit: 2 * 1024 * 1024 });
  await bottomTab("Output");
  pass("Scene > Import Sound... adds a player using the new sound; stereo 44.1 kHz became mono 32 kHz and the log says so; the Hardware tab counts 130150 bytes");

  // ---- The preview, measured on the editor's real audio output.
  await selectRow("AudioStreamPlayer");
  const meterDone = startMeter(app.pid, 52);
  await sleep(3800); // the meter needs a moment to start
  const phases = {};
  const phase = async (name, action, { hold, until }) => {
    const from = Date.now();
    await action();
    await sleep(hold);
    const seen = until ? await until() : undefined;
    phases[name] = { from, to: null, seen };
    return phases[name];
  };
  const endPhase = (name) => { phases[name].to = Date.now(); };

  // 1. Not looping, 100%, pitch 1: plays once for its length and stops by itself.
  let p = await phase("once", clickPlay, { hold: 600, until: async () => ({ mid: await audio() }) });
  assert.equal(p.seen.mid.play, "Stop", "Play became Stop");
  const t1 = p.seen.mid.time;
  await sleep(900);
  const later = await audio();
  assert.notEqual(later.time, t1, "the position advanced");
  assert.match(later.time, /^0:01 \/ 0:01$/, "at about 1.5 s the position reads 0:01");
  await sleep(1400);
  const finished = await audio();
  assert.equal(finished.play, "Play", "a sound that isn't looping ends by itself, and Stop becomes Play");
  assert.match(finished.time, /^0:00 \/ 0:01$/, "and rewinds");
  endPhase("once");
  await sleep(700);

  // 2. Looping at 100%, then the volume drops to 50% while it plays.
  await clickCheckbox("Loop");
  await sleep(150);
  p = await phase("loop100", clickPlay, { hold: 2600, until: async () => audio() });
  assert.equal(p.seen.play, "Stop", "a looping 1.5 s sound is still playing after 2.6 s");
  endPhase("loop100");
  await setRange("Volume", 50);
  const halfFrom = Date.now() + 250; // let the change settle before measuring
  await sleep(250);
  await sleep(1700);
  phases.loop50 = { from: halfFrom, to: Date.now() };
  assert.equal((await audio()).play, "Stop", "changing the volume didn't stop it");
  await clickPlay();
  await sleep(300);
  a = await audio();
  assert.equal(a.play, "Play");
  assert.match(a.time, /^0:00 \//, "Stop rewinds");
  await sleep(600);

  // 3. Pitch 2, no loop, 100%: takes half as long.
  await clickCheckbox("Loop");
  await setRange("Volume", 100);
  await setRange("Pitch", 2);
  await sleep(200);
  a = await audio();
  assert.deepEqual([a.loop, a.volume, a.pitch], [false, 100, 2]);
  assert.match(a.text, /Plays at 44100 Hz/, "the Inspector says what rate the DS plays at");
  p = await phase("pitch2", clickPlay, { hold: 500, until: async () => audio() });
  assert.equal(p.seen.play, "Stop");
  await sleep(1000);
  assert.equal((await audio()).play, "Play", "at 2x pitch a 1.5 s sound has ended within 1.5 s");
  endPhase("pitch2");
  await sleep(600);

  // 4. Pitch 0.5: twice as long.
  await setRange("Pitch", 0.5);
  await sleep(200);
  p = await phase("pitchHalf", clickPlay, { hold: 2000, until: async () => audio() });
  assert.equal(p.seen.play, "Stop", "at 0.5x pitch a 1.5 s sound is still playing after 2 s");
  await sleep(1500);
  assert.equal((await audio()).play, "Play");
  endPhase("pitchHalf");
  await sleep(600);

  // 4b. Pitch changed WHILE playing applies at once: 0.3 s at 1x, then the remaining 1.2 s at 4x (0.3 s), about 0.6 s in all.
  await setRange("Pitch", 1);
  await sleep(200);
  await phase("pitchLive", clickPlay, { hold: 300 });
  await setRange("Pitch", 4);
  await sleep(1300);
  assert.equal((await audio()).play, "Play", "raising the pitch mid-sound made it finish early");
  endPhase("pitchLive");
  await sleep(600);

  // 4c. Loop switched off WHILE looping: the sound finishes the pass it is in (two passes of 1.5 s = 3 s in all).
  await setRange("Pitch", 1);
  await clickCheckbox("Loop");
  await sleep(200);
  await phase("loopOffLive", clickPlay, { hold: 2000 });
  assert.equal((await audio()).play, "Stop", "still looping after 2 s");
  await clickCheckbox("Loop");
  await sleep(1800);
  assert.equal((await audio()).play, "Play", "with Loop switched off it ended at the end of that pass");
  endPhase("loopOffLive");
  await sleep(600);

  // 5. Selecting something else stops the preview.
  await setRange("Pitch", 1);
  await clickCheckbox("Loop");
  const stopFrom = Date.now();
  await clickPlay();
  await sleep(1200);
  assert.equal((await audio()).play, "Stop");
  const beforeSelect = Date.now();
  await selectRow("stereo-44k");
  await sleep(300);
  const silentFrom = Date.now();
  await sleep(1500);
  phases.silentAfterSelect = { from: silentFrom, to: Date.now() };
  assert.equal((await audio()).play, "Play", "the other player isn't playing");
  await selectRow("AudioStreamPlayer");
  assert.equal((await audio()).play, "Play", "and coming back, the first isn't either");
  await clickCheckbox("Loop"); // (phase 5 turned it on; the rest of the script wants it off)
  phases.playingBeforeSelect = { from: stopFrom + 400, to: beforeSelect };

  const trace = await meterDone;
  assert.ok(trace.everSawSession, "the editor made sound the meter could see");
  const heard = Object.fromEntries(Object.entries(phases).map(([name, ph]) => [name, summarize(trace, ph.from, ph.to)]));
  for (const [name, h] of Object.entries(heard)) console.log(`  [audio] ${name}: heard=${h.heard} ${h.seconds.toFixed(2)} s, level ${h.level.toFixed(3)}, max ${h.maxPeak.toFixed(3)}`);

  assert.ok(heard.once.heard, "the preview made sound");
  assert.ok(heard.once.level > 0.3 && heard.once.level < 0.6, `a 0.5-amplitude tone at 100% reads about 0.5 (got ${heard.once.level})`);
  assert.ok(heard.once.seconds > 1.3 && heard.once.seconds < 1.75, `a non-looping 1.5 s sound sounded for about 1.5 s (got ${heard.once.seconds})`);
  pass("the preview really plays at the right level and for the sound's length, then stops by itself (measured on the editor's audio output)");

  assert.ok(heard.loop100.heard && heard.loop100.seconds > 2.2, `a looping sound kept sounding past its 1.5 s (got ${heard.loop100.seconds})`);
  const ratio = heard.loop50.level / heard.loop100.level;
  assert.ok(ratio > 0.42 && ratio < 0.58, `dropping the volume to 50% while playing halved the loudness (got ${ratio.toFixed(3)})`);
  pass("Loop keeps the sound going, and changing the volume while it plays changes the loudness live (50% is half as loud)");

  assert.ok(heard.pitch2.seconds > 0.55 && heard.pitch2.seconds < 1.0, `at 2x a 1.5 s sound lasts about 0.75 s (got ${heard.pitch2.seconds})`);
  assert.ok(heard.pitchHalf.seconds > 2.7 && heard.pitchHalf.seconds < 3.4, `at 0.5x it lasts about 3 s (got ${heard.pitchHalf.seconds})`);
  pass("pitch changes how fast it plays: 2x lasts half as long (0.75 s), 0.5x twice as long (3 s), measured on the audio output");

  assert.ok(heard.pitchLive.seconds > 0.45 && heard.pitchLive.seconds < 0.9, `raising the pitch to 4x after 0.3 s left about 0.6 s of sound in all (got ${heard.pitchLive.seconds})`);
  assert.ok(heard.loopOffLive.seconds > 2.6 && heard.loopOffLive.seconds < 3.4, `switching Loop off during the second pass ended the sound at 3 s (got ${heard.loopOffLive.seconds})`);
  pass("pitch and Loop take effect while the sound is playing, without restarting it (measured: the sound ended at 0.6 s and 3.0 s as the changes predict)");

  assert.ok(heard.playingBeforeSelect.heard, "it was sounding before another node was selected");
  assert.ok(!heard.silentAfterSelect.heard && heard.silentAfterSelect.maxPeak < SILENCE, `selecting another node silenced the preview (max peak ${heard.silentAfterSelect.maxPeak})`);
  pass("selecting another node stops the preview (silence measured)");

  // ---- Seeking.
  await page.evaluate(() => document.querySelector("[data-testid=audio-player] input[aria-label=Position]").scrollIntoView());
  await setRange("Position", 1.0);
  await sleep(200);
  a = await audio();
  assert.match(a.time, /^0:01 \/ 0:01$/, "the position bar moves the position while stopped");
  await clickPlay();
  await sleep(300);
  assert.equal((await audio()).play, "Stop");
  await clickPlay();
  a = await audio();
  assert.match(a.time, /^0:00 \//, "Stop rewinds to the start");
  pass("the position bar seeks");

  // ---- Settings: autoplay note, saved values.
  await clickCheckbox("Autoplay on load");
  await sleep(150);
  a = await audio();
  assert.equal(a.autoplay, false);
  assert.match(a.text, /nothing starts this sound unless a script calls play\(\) on it: it stays silent/);
  await clickCheckbox("Autoplay on load");
  await setRange("Volume", 40);
  await setRange("Pitch", 1.5);
  await sleep(200);
  a = await audio();
  assert.deepEqual([a.autoplay, a.loop, a.volume, a.pitch], [true, false, 40, 1.5]);
  assert.match(a.text, /level 51\./, "40% is DS volume level 51");
  assert.match(a.text, /Plays at 33075 Hz/, "22050 Hz at 1.5x plays at 33075 Hz");
  pass("Autoplay warns when off; volume 40% is DS level 51 and pitch 1.5 on a 22050 Hz sound plays at 33075 Hz");

  // ---- A slider drag is one undo step (real mouse).
  await selectRow("stereo-44k");
  await saveProject();
  await page.evaluate(() => document.querySelector("[data-testid=audio-player] input[aria-label=Volume]").scrollIntoView({ block: "center" }));
  const slider = await (await page.$("[data-testid=audio-player] input[aria-label=Volume]")).boundingBox();
  await page.mouse.move(slider.x + slider.width - 3, slider.y + slider.height / 2);
  await page.mouse.down();
  for (const f of [0.8, 0.6, 0.45, 0.3]) { await page.mouse.move(slider.x + slider.width * f, slider.y + slider.height / 2, { steps: 4 }); }
  await page.mouse.up();
  await sleep(200);
  const dragged = (await audio()).volume;
  assert.ok(dragged > 15 && dragged < 45, `dragging the slider set the volume (${dragged})`);
  await blurFocus();
  await chord("z");
  assert.equal((await audio()).volume, 100, "one Ctrl+Z undid the whole drag");
  await chord("z", { shift: true });
  assert.equal((await audio()).volume, dragged, "and Ctrl+Shift+Z redid it");
  await chord("z");
  pass("a real mouse drag of the volume slider is one undo step");

  // ---- Undo of an import removes the sound and the player.
  await selectRow("Main");
  const bytesBefore = (await soundBytes()).used;
  await importFromMenu("tone-mono-22k.wav");
  assert.equal((await rowNames()).filter((n) => n === "tone-mono-22k").length, 1);
  assert.equal((await soundBytes()).used, bytesBefore + 66150);
  await bottomTab("Output");
  await blurFocus();
  await chord("z");
  assert.ok(!(await rowNames()).includes("tone-mono-22k"), "the imported player is gone");
  assert.equal((await soundBytes()).used, bytesBefore, "and its sound with it");
  await chord("z", { shift: true });
  assert.ok((await rowNames()).includes("tone-mono-22k"), "redo brings it back");
  assert.equal((await soundBytes()).used, bytesBefore + 66150);
  await chord("z");
  await bottomTab("Output");
  pass("Ctrl+Z after an import removes the player and its sound (the memory bar follows); Ctrl+Shift+Z brings both back");

  // ---- Saved: shared sounds once, unused sounds dropped, settings kept.
  await selectRow("stereo-44k");
  await menu("Scene");
  await click("Duplicate Node");
  await sleep(250);
  await clickCheckbox("Autoplay on load"); // the copy is selected (it keeps its name); it stays silent in the ROM
  await selectRow("Main");
  await importFromMenu("tone-mono-22k.wav"); // a third sound; its player is deleted again below
  await selectRow("tone-mono-22k");
  await menu("Scene");
  await click("Delete Node");
  await sleep(250);
  await selectRow("stereo-44k"); // the first row of that name: the original
  await clickCheckbox("Autoplay on load"); // and so does the original
  await saveProject();
  const saved = readProject();
  assert.equal(saved.sounds.length, 2, "two sounds: the shared one once, the unused one dropped");
  assert.deepEqual(saved.sounds.map((s) => s.sampleRate).sort(), [22050, 32000]);
  const mono = saved.sounds.find((s) => s.sampleRate === 22050);
  assert.equal(Buffer.from(mono.samples, "base64").length, 66150, "22050 Hz x 1.5 s x 2 bytes");
  assert.equal(Buffer.from(saved.sounds.find((s) => s.sampleRate === 32000).samples, "base64").length, 64000);
  const players = saved.scene.children.filter((c) => c.kind === "AudioStreamPlayer");
  assert.deepEqual(players.map((c) => c.name), ["AudioStreamPlayer", "stereo-44k", "stereo-44k"], "the original and its copy");
  assert.equal(players[1].audio.soundId, players[2].audio.soundId, "the copy shares the sound");
  assert.deepEqual({ ...players[0].audio, soundId: undefined }, { soundId: undefined, autoplay: true, volume: 0.4, pitch: 1.5, loop: false });
  assert.deepEqual([players[1].audio.autoplay, players[2].audio.autoplay], [false, false]);
  assert.equal(saved.formatVersion, 1);
  pass("saving writes each used sound once (the shared one once, the unused one dropped) as mono 16-bit, and each player's settings");

  // ---- Reopen.
  await menu("Project");
  await click("Close Project");
  await waitText("Open Existing Project");
  await answerOpen(PROJECT_PATH);
  await click("Open Existing Project");
  await click("Browse…");
  await waitText("Scene Tree");
  await selectRow("AudioStreamPlayer");
  a = await audio();
  assert.equal(a.sound, "tone-mono-22k (0:01, 22050 Hz)");
  assert.deepEqual([a.autoplay, a.loop, a.volume, a.pitch], [true, false, 40, 1.5]);
  await selectRow("stereo-44k");
  a = await audio();
  assert.equal(a.sound, "stereo-44k (0:01, 32000 Hz)");
  assert.equal(a.autoplay, false);
  assert.deepEqual(await soundBytes(), { used: 130150, limit: 2 * 1024 * 1024 });
  await bottomTab("Output");
  pass("closing and reopening keeps the sounds and every player's settings");

  // ---- Optional: a real MP3.
  if (process.env.GSDS_TEST_MP3 && existsSync(process.env.GSDS_TEST_MP3)) {
    await selectRow("Main");
    await bottomTab("Output");
    const countIn = (text, re) => (text.match(re) ?? []).length;
    const importedBefore = countIn(await body(), /Imported sound "/g);
    const failedBefore = countIn(await body(), /Could not import/g);
    const rowsBeforeMp3 = await rowNames();
    await answerOpen(process.env.GSDS_TEST_MP3.replace(/\\/g, "/"));
    await menu("Scene");
    await click("Import Sound...");
    await page.waitForFunction(
      (imported, failed) => (document.body.innerText.match(/Imported sound "/g) ?? []).length > imported || (document.body.innerText.match(/Could not import/g) ?? []).length > failed,
      { timeout: 30000 },
      importedBefore,
      failedBefore
    );
    out = await body();
    assert.equal((out.match(/Imported sound "/g) ?? []).length, importedBefore + 1, `the MP3 imported (log: ${out.split("\n").filter((l) => /Could not|Imported sound/.test(l)).slice(-3).join(" | ")})`);
    const mp3Name = process.env.GSDS_TEST_MP3.split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
    const lines = [...out.matchAll(/Imported sound "([^"]+)" \((\d+:\d\d), (\d+) Hz, (\d+) bytes of sound memory\) as node/g)];
    const line = lines.at(-1);
    assert.equal(line[1], mp3Name, "the newest import is the MP3, named after its file");
    assert.ok(Number(line[3]) <= 32000 && Number(line[4]) > 0);
    assert.equal((await rowNames()).length, rowsBeforeMp3.length + 1, "and it added a player");
    console.log(`  [mp3] "${line[1]}" ${line[2]} at ${line[3]} Hz, ${line[4]} bytes`);
    console.log(`  [mp3] warnings: ${out.split("\n").filter((l) => l.startsWith("Warning: It")).slice(-2).join(" | ")}`);
    await chord("z");
    pass(`an MP3 (${process.env.GSDS_TEST_MP3.split(/[\\/]/).pop()}) decodes and converts to mono at ${line[3]} Hz`);
  } else {
    console.log("  (no GSDS_TEST_MP3 given: MP3 import not exercised)");
  }

  // ---- Export a ROM from the UI and run it: only the autoplay player sounds, at its volume and pitch.
  await bottomTab("Output");
  await answerSave(ROM_PATH);
  await menu("Project");
  await click("Export ROM...");
  await waitText("Exported ROM to", 120000);
  out = await body();
  assert.match(out, /Warning \[stereo-44k\]: Autoplay is off and no script calls play\(\) on this player, so nothing starts this sound; it stays silent\./);
  assert.equal((out.match(/Warning \[stereo-44k\]: Autoplay is off/g) ?? []).length, 2, "one warning for each silent player");
  assert.equal(readFileSync(ROM_PATH).subarray(0, 8).toString(), "HOMEBREW");
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", METER, "-Rom", ROM_PATH, "-Seconds", "8"], { encoding: "utf-8", timeout: 90000 });
  assert.equal(run.status, 0, run.stderr);
  const romTrace = JSON.parse(run.stdout.trim().split("\n").pop().replace(/^﻿/, ""));
  const rom = summarize({ ...romTrace, startedAtEpochMs: 0 }, 0, 9e9);
  console.log(`  [audio] rom: heard=${rom.heard} ${rom.seconds.toFixed(2)} s, level ${rom.level.toFixed(4)}, onset ${rom.onsetMs} ms`);
  assert.ok(rom.heard, "the exported ROM made sound in the emulator");
  // A 0.5-amplitude tone reads 0.2504 in melonDS at full volume; this player is at 40% = DS level 51 of 127.
  assert.ok(rom.level > 0.09 && rom.level < 0.115, `at 40% the ROM's level is 51/127 of 0.2504 = 0.1006 (got ${rom.level})`);
  // 1.5 s of sound at 1.5x pitch lasts 1.0 s.
  assert.ok(rom.seconds > 0.85 && rom.seconds < 1.2, `at 1.5x pitch the 1.5 s sound lasts 1.0 s (got ${rom.seconds})`);
  pass("Export ROM warns about the players with Autoplay off; the ROM, run in melonDS, plays only the autoplay sound, at 40% volume and 1.5x pitch (level 0.1006, 1.0 s), as authored in the UI");

  console.log(`\nAll ${checks} checks passed.`);
} catch (err) {
  console.error("FAILED:", err);
  try { if (page) await page.screenshot({ path: join(HERE, "sound-player-failure.png") }); } catch {}
  process.exitCode = 1;
} finally {
  app.kill();
  try { spawn("taskkill", ["/F", "/IM", "electron.exe", "/T"], { stdio: "ignore" }); } catch {}
  try { spawn("taskkill", ["/F", "/IM", "melonDS.exe"], { stdio: "ignore" }); } catch {}
}

function blurFocus() { return page.evaluate(() => document.activeElement?.blur?.()); }
