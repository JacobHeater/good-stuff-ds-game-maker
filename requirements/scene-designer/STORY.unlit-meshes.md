---
status: done
component: scene-designer
related: [STORY.mesh-colors.md, BUG.editor-lighting-differs-from-rom.md, ../compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md]
---

# Story: Unlit meshes

## Context
Owner request: a toggle so a MeshInstance3D can be made to ignore the scene's lights and always show its own color, instead of being shaded by them. Called out as not built in `STORY.mesh-colors.md`. Useful for a HUD-like
prop, a glowing effect, or anything that should read the same regardless of how the scene happens to be lit.

## Decisions (owner delegated; say if any is wrong)
- A `MeshInstance3D` has an optional **`unlit`** (`mesh.unlit`, boolean, absent = false = lit normally, the existing behavior). When true, the mesh always shows its own diffuse color (`mesh.color`, or the default grey/white)
  at full brightness, exactly as any mesh already does in a scene with **no** lights at all (`ds-lighting.ts`'s existing "with no lights a polygon isn't lit at all" rule) — this toggle is that same look, per mesh, whether
  or not the scene actually has lights.
- Inspector: a checkbox, "Unlit (ignores the scene's lights; always shown at full brightness)", next to the mesh's color. `SET_MESH_UNLIT`.
- Editor/ROM parity kept (`BUG.editor-lighting-differs-from-rom.md`'s own rule): the viewport's DS-lighting shader (`ds-lighting-material.ts`) gained a `uUnlit` uniform with the identical effect.

## Description
- Core: `MeshInstance3DData.unlit?: boolean` (`scene-node.ts`); schema allows it (`project-snapshot.schema.ts`).
- Compiler: `DsMesh.unlit` (`ds-scene.ts`), set from `node.mesh.unlit === true` (`translate-scene-3d.ts`); emitted as `GsMesh`'s own trailing field (`scene-data-writer.ts`; bumped `GsMesh`'s layout, so existing exact-string
  C-output tests and the checked-in `scene_data.c` fallback needed updating, same as any struct-layout change).
- Runtime (`main.c`): the mesh-drawing loop already had an unlit code path (`draw_mesh`'s `lit` parameter sets `GL_EMISSION` to the mesh's own diffuse when false, which is what a scene with no lights already used) — it was
  just driven by one scene-wide condition. Now `glPolyFmt` (which lights are enabled for a polygon) and `lit` are both computed **per mesh**: an unlit mesh's polygons carry no light bits at all — not just the emission
  trick alone, since a light bit left set would still add that light's own contribution on top of the emission color — and always get `lit = false`, regardless of how many lights are in the scene.
- UI: checkbox in `InspectorPanel.tsx`; viewport parity via `ds-lighting-material.ts`'s `uUnlit` uniform (`Viewport3D.tsx` passes `mesh.unlit`).

## Notes (built and verified)
- Unit tests: `compiler/src/unlit-mesh.test.ts`, `ui/.../mesh-unlit-edits.test.ts`.
- On the DS (emulator): `testing/lighting.rom.test.ts` gained a case — a plane lit edge-on (90 degrees, which reads nearly black when lit normally, proven by the existing cases) reads full brightness when set unlit,
  proving the light is genuinely ignored, not just weakly angled. The existing 10 lighting cases and the `rom-output.rom.test.ts`/`animated-meshes.rom.test.ts` suites still pass unchanged after the `main.c` and `GsMesh` changes.
- **Not verified:** the checkbox in the real app (no E2E). **Not built:** per-vertex or per-face unlit (it's a whole-mesh toggle), an "emissive color" distinct from the diffuse color (an unlit mesh shows its diffuse, not a
  separate glow color), unlit for 2D sprites (they were never lit to begin with — the 2D screen has no lighting model at all).
