---
status: done
component: scene-designer
related: [STORY.mesh-colors.md, STORY.unlit-meshes.md]
---

# Story: Mesh face culling

## Context
Owner report: a mountain mesh showed as a solid dark shape instead of correctly lit terrain, and asked for "a toggle on mesh
instances to fix this face culling". The DS runtime has always drawn every mesh with culling off (`POLY_CULL_NONE`, both sides
of every triangle) — forgiving of an imported model whose winding was never checked, at the cost of exactly this symptom: if a
mesh's winding doesn't agree with its normals (common for an import that was mirrored, or whose winding just wasn't verified),
the side facing the camera can be the one the lighting math treats as facing *away* from every light, reading as a flat dark
patch instead of being culled away and simply not drawn. There was no way to turn culling on for a specific mesh to find out.

## Decisions (owner delegated; say if any is wrong)
- A `MeshInstance3D` has an optional **`cull`**: `"none"` (both sides — the default, unchanged from today), `"back"` (only the
  side a correctly-wound triangle's winding faces outward from — the usual choice for a solid, fully enclosed mesh), or
  `"front"` (only the other side — a mesh meant to be seen from the inside, or one whose winding turned out backward).
- Inspector: a "Face culling" dropdown next to a mesh's color and unlit fields. `SET_MESH_CULL`.
- Editor/ROM parity: the viewport's DS-lighting material now derives its three.js `side` directly from the mesh's own `cull`
  (`none` → `DoubleSide`, `back` → `FrontSide`, `front` → `BackSide`) instead of the old heuristic (double-sided only for a
  plane or an imported model, single-sided otherwise) — a closer match to the ROM's own actual behavior, since the ROM was
  always double-sided by default for every mesh, not only planes and imports.

## Description
- Core: `MeshCullMode` and `MeshInstance3DData.cull?: MeshCullMode` (`scene-node.ts`); schema allows it.
- Compiler: `DsMesh.cull` (`ds-scene.ts`), set from `node.mesh.cull ?? "none"` (`translate-scene-3d.ts`); emitted as `GsMesh`'s
  own trailing field (`scene-data-writer.ts`; bumped `GsMesh`'s layout — the usual exact-string-test/`scene_data.c` ritual).
- Runtime (`main.c`, `scene.h`): `GS_CULL_NONE/BACK/FRONT` map to the geometry engine's own `POLY_CULL_NONE/BACK/FRONT`; the
  mesh-drawing loop (already computing `glPolyFmt` per mesh, from the unlit story) now also folds in each mesh's own cull bits.
- UI: dropdown in `InspectorPanel.tsx`; viewport parity via `Viewport3D.tsx`'s `side`.

## Notes (built and verified)
- Unit tests: `compiler/src/mesh-cull.test.ts`, `ui/.../mesh-cull-edits.test.ts`.
- On the DS (emulator): `testing/mesh-cull.rom.test.ts` — a plane facing the camera head-on (the same setup the lighting
  tests use) is visible by default and with `cull: "back"` (the camera is looking at the front), and genuinely vanishes with
  `cull: "front"` (the camera is looking at exactly the side that's now culled). Caught and fixed a bug in the test itself
  along the way, not the feature: comparing a captured pixel against the backdrop's raw 5-bit color instead of the 8-bit value
  melonDS actually scales it to in the PNG it captures, which made every "is this the backdrop" check fail regardless of what
  was really drawn — a debug dump of the actual pixel values (`covered`/center-pixel readings for all three cull modes) is
  what found it. The rest of the fast suite (1117 tests) still passes unchanged.
- **Not built:** a per-mesh way to flip a model's winding/normals outright (this toggle changes what's *drawn*, not what the
  mesh's own geometry says its winding is), and no attempt was made to auto-detect or auto-fix a mesh whose winding disagrees
  with its normals — the owner's mountain still needs `cull` set by hand (try `back`, then `front`, whichever looks right) or
  its source model's winding fixed at the source.
