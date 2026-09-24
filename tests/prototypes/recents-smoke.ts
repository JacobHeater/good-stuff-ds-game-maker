// Throwaway smoke test for the recent-projects store (no test framework in the repo yet).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryProjectFileStore,
  InMemoryRecentProjects,
  JsonFileRecentProjectsStore,
  NodeProjectFileReader,
  NodeProjectFileWriter,
  createPathKey,
  type RecentProjectsReader,
  type RecentProjectsWriter
} from "@goodstuff/persistence";
import { MAX_RECENT_PROJECTS, type RecentProjectEntry } from "@goodstuff/core";

const entry = (path: string, name = "P", mode: "2D" | "3D" = "2D", at = "2026-01-01T00:00:00.000Z"): RecentProjectEntry => ({
  path, name, mode, lastOpenedAt: at
});
const present = { exists: async () => true };
let n = 0;
const ok = (m: string) => console.log(`[PASS] ${m} (${++n})`);

// Run the same behavioral suite against every implementation: Liskov substitutability.
async function suite(label: string, make: () => Promise<{ store: RecentProjectsReader & RecentProjectsWriter; markGone: (p: string) => void }>) {
  // ordering + dedupe
  let { store } = await make();
  await store.record(entry("/p/a.gsds", "A"));
  await store.record(entry("/p/b.gsds", "B", "3D"));
  await store.record(entry("/p/a.gsds", "A2"));
  let list = await store.list();
  assert.deepEqual(list.map((e) => e.name), ["A2", "B"], `${label}: re-record moves to top, no duplicate`);
  assert.equal(list[1].mode, "3D");
  assert.ok(list.every((e) => e.missing === false));
  ok(`${label}: most-recent-first, re-record moves to top without duplicating`);

  // cap
  ({ store } = await make());
  for (let i = 0; i < MAX_RECENT_PROJECTS + 1; i++) await store.record(entry(`/p/${i}.gsds`, `N${i}`));
  list = await store.list();
  assert.equal(list.length, MAX_RECENT_PROJECTS);
  assert.equal(list[0].name, `N${MAX_RECENT_PROJECTS}`);
  assert.ok(!list.some((e) => e.name === "N0"), "oldest dropped");
  ok(`${label}: capped at ${MAX_RECENT_PROJECTS}, oldest dropped`);

  // remove / clear
  ({ store } = await make());
  await store.record(entry("/p/a.gsds", "A"));
  await store.record(entry("/p/b.gsds", "B"));
  await store.remove("/p/a.gsds");
  await store.remove("/p/never-recorded.gsds");
  assert.deepEqual((await store.list()).map((e) => e.name), ["B"]);
  await store.clear();
  assert.deepEqual(await store.list(), []);
  ok(`${label}: remove only removes that entry (unknown path is a no-op); clear empties`);

  // concurrency: overlapping records must all land
  ({ store } = await make());
  await Promise.all([1, 2, 3, 4, 5].map((i) => store.record(entry(`/p/c${i}.gsds`, `C${i}`))));
  assert.equal((await store.list()).length, 5);
  ok(`${label}: overlapping record calls don't lose entries`);
}

// case-insensitive identity (explicit, so the test doesn't depend on the host OS)
{
  const store = new InMemoryRecentProjects({ pathKey: createPathKey(true) });
  await store.record(entry("C:/Games/Cube.gsds", "Cube"));
  await store.record(entry("c:/games/CUBE.gsds", "Cube"));
  assert.equal((await store.list()).length, 1);
  const sensitive = new InMemoryRecentProjects({ pathKey: createPathKey(false) });
  await sensitive.record(entry("/Games/Cube.gsds"));
  await sensitive.record(entry("/games/cube.gsds"));
  assert.equal((await sensitive.list()).length, 2);
  ok("path identity: same project differing only by case is one entry when case-insensitive, two when not");
}

// in-memory
await suite("in-memory", async () => ({ store: new InMemoryRecentProjects(), markGone: () => {} }));

// JSON store over the in-memory file store (same file ports, no disk)
await suite("json+memory-files", async () => {
  const files = new InMemoryProjectFileStore();
  return { store: new JsonFileRecentProjectsStore(files, files, "/userData/recent-projects.json", { existence: present }), markGone: () => {} };
});

// JSON store over real disk
const dir = mkdtempSync(join(tmpdir(), "gsds-recents-"));
let counter = 0;
await suite("json+disk", async () => ({
  store: new JsonFileRecentProjectsStore(new NodeProjectFileReader(), new NodeProjectFileWriter(), join(dir, `r${counter++}.json`), { existence: present }),
  markGone: () => {}
}));

// missing flag: real files
{
  const real = join(dir, "real.gsds");
  writeFileSync(real, "{}");
  const files = new NodeProjectFileReader();
  const store = new JsonFileRecentProjectsStore(files, new NodeProjectFileWriter(), join(dir, "missing.json"));
  await store.record(entry(real, "Real"));
  await store.record(entry(join(dir, "gone.gsds"), "Gone"));
  const list = await store.list();
  assert.equal(list.find((e) => e.name === "Real")!.missing, false);
  assert.equal(list.find((e) => e.name === "Gone")!.missing, true);
  assert.equal(list.length, 2, "missing entries are kept, not pruned");
  // the in-memory substitute agrees when given an equivalent checker
  const mem = new InMemoryRecentProjects({ existence: { exists: async (p) => p === real } });
  await mem.record(entry(real, "Real"));
  await mem.record(entry(join(dir, "gone.gsds"), "Gone"));
  assert.deepEqual(await mem.list(), list);
  ok("missing files are flagged, never pruned; in-memory agrees with JSON given the same checker");
}

// corrupt / invalid / absent stores are an empty list, and heal on next write
for (const [label, contents] of [
  ["not JSON", "{{{ nope"],
  ["wrong shape", JSON.stringify({ formatVersion: 1, projects: [{ path: "x" }] })],
  ["wrong version", JSON.stringify({ formatVersion: 99, projects: [] })],
  ["empty file", ""]
] as const) {
  const path = join(dir, `bad-${label.replace(/\s/g, "-")}.json`);
  writeFileSync(path, contents);
  const store = new JsonFileRecentProjectsStore(new NodeProjectFileReader(), new NodeProjectFileWriter(), path);
  assert.deepEqual(await store.list(), [], `${label} reads as empty`);
  await store.record(entry("/p/a.gsds", "A"));
  assert.equal((await store.list()).length, 1, `${label} heals on write`);
  JSON.parse(readFileSync(path, "utf8"));
}
{
  const path = join(dir, "does-not-exist.json");
  const store = new JsonFileRecentProjectsStore(new NodeProjectFileReader(), new NodeProjectFileWriter(), path);
  assert.deepEqual(await store.list(), []);
  assert.ok(!existsSync(path), "reading doesn't create the file");
  ok("absent, non-JSON, wrong-shape, wrong-version and empty stores all read as an empty list, never throw, and heal on write");
}

// file on disk is schema-shaped
{
  const path = join(dir, "shape.json");
  const store = new JsonFileRecentProjectsStore(new NodeProjectFileReader(), new NodeProjectFileWriter(), path);
  await store.record(entry("/p/a.gsds", "A", "3D"));
  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(onDisk.formatVersion, 1);
  assert.deepEqual(onDisk.projects, [entry("/p/a.gsds", "A", "3D")]);
  assert.ok(!("missing" in onDisk.projects[0]), "missing is never stored");
  ok("stored file is { formatVersion: 1, projects: [...] } and never contains `missing`");
}

console.log(`\n${n} store checks passed.`);
