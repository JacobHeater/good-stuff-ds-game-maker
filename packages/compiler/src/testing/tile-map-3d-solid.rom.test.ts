import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, afterAll, beforeAll, expect, it } from "vitest";

import { NodeToolchainLocator } from "../build/node-adapters";
import type { DsScene3D } from "../ds-scene";
import { tileMap3DSolidProject } from "../fixtures";
import { translateScene3D } from "../translate-scene-3d";
import { runDump, type DumpItem } from "./framebuffer-dump";

/**
 * `gs_tile_solid_3d` (STORY.tile-map-3d.md), on the DS's own CPU via the `runDump` harness (precise, no pixel
 * capture needed -- the query itself returns a value, read straight back). `tileMap3DSolidProject` paints a solid
 * tile and a non-solid one near the grid's own origin, and a third, solid one far enough away (chunk 12) to fall
 * outside the runtime's own default-loaded 3x3x3 chunk window -- proving both the ordinary case and the one real
 * limitation this query has that a plain TileMap/CollisionShape3D one doesn't (STORY.tile-map-3d.md's own notes).
 */

const toolchain = await new NodeToolchainLocator().locate();
const F = (x: number): number => Math.round(x * 4096);

describe.skipIf(!toolchain.found)("gs_tile_solid_3d on the DS", () => {
  const work = mkdtempSync(join(tmpdir(), "gsds-tile-solid-3d-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  const translated = translateScene3D(tileMap3DSolidProject());
  if (!translated.scene) throw new Error(translated.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const scene: DsScene3D = translated.scene;
  const gridNode = scene.nodes.findIndex((n) => n.name === "Grid");

  /** Loads TileMap3D 0's own window around (cameraX, 0, 0), as a dump item's own `setup`; `expr` then queries gs_tile_solid_3d at (x, 0, 0) -- all world units, f32. */
  const setupAt = (cameraX: number): string => `
    extern void tm3d_init(void);
    extern void tm3d_refresh(int, const GsTileMap3D *, const int32_t[3]);
    gs_init_nodes();
    gs_update_nodes();
    tm3d_init();
    const int32_t cameraWorld[3] = { ${F(cameraX)}, 0, 0 };
    tm3d_refresh(0, &gs_scene.tileMaps3D[0], cameraWorld);`;
  const queryAt = (x: number): string => `gs_tile_solid_3d(${gridNode}, ${F(x)}, 0, 0)`;

  let values: number[] = [];
  interface Case {
    name: string;
    setup: string;
    expr: string;
    expected: number;
  }
  const cases: Case[] = [
    { name: "the solid tile reads solid", setup: setupAt(0), expr: queryAt(0), expected: 1 },
    { name: "the non-solid tile (a different palette entry) reads not solid", setup: setupAt(0), expr: queryAt(1), expected: 0 },
    { name: "an unpainted cell inside the loaded window reads not solid", setup: setupAt(0), expr: queryAt(2), expected: 0 },
    { name: "a solid tile outside the streamed window reads not solid, not \"unknown\" (the one real limitation this query has)", setup: setupAt(0), expr: queryAt(100), expected: 0 },
    { name: "the far tile reads solid once the window is centred near it instead", setup: setupAt(100), expr: queryAt(100), expected: 1 }
  ];

  beforeAll(async () => {
    const items: DumpItem[] = cases.map((c) => ({ setup: c.setup, expr: c.expr }));
    values = (await runDump(scene, items, work, "tile-map-3d-solid", 40)).values;
  }, 120_000);

  cases.forEach((c, i) => {
    it(c.name, () => expect(values[i]).toBe(c.expected));
  });
});
