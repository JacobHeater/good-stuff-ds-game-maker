---
status: done
component: scene-designer
related: [STORY.import-obj-model.md, ../compiler/BUG.rom-lighting-breaks-on-scaled-meshes.md]
---

# Story: Mesh colors

## Context
Found by building the coin collector (`STORY.coin-collector-example.md`): every mesh was the same grey, so the player, the coins, the ground and the walls looked alike. The only way to color a mesh was a texture. A game
needs a color per object.

## Decisions (owner delegated; say if any is wrong)
- A `MeshInstance3D` has an optional **color** (`mesh.color`, "#rrggbb"). It is the mesh's **diffuse color**, which the DS lights: each directional light adds `(ambient + diffuse * cos) * light color`, per vertex, as before.
  A mesh with no color is the DS's plain grey (24 of 31), or white when it has a texture (so the picture shows in its own colors). A textured mesh **with** a color is **tinted** by it.
- The DS holds 5 bits a channel, so the color is snapped to the 32 levels when it is chosen (what is stored is what is drawn); the editor's viewport shades with the same color.
- Inspector: a color picker and a **Default** button under the mesh's fields. Dragging in the picker is one undo step per pause. `SET_MESH_COLOR`.

## Description
- Core: `MeshInstance3DData.color`, `mesh-color.ts` (`parseMeshColor`, `meshColorFromLevels`, `getMeshDiffuseLevels`); the schema allows `color` (`^#rrggbb$`).
- Compiler: `DsMesh.diffuse` (RGB15) comes from `getMeshDiffuseLevels`. Viewport: the material's diffuse.

## Notes (built and verified)
- Unit tests: `core/src/mesh-color.test.ts`, `compiler/src/mesh-colors.test.ts`, `ui/.../mesh-color-edits.test.ts`. The example game's screenshot in melonDS shows the colors (green ground, blue player, red chaser, yellow coins, brown crate).
- **Not verified:** the color picker in the real app (no E2E). **Not built:** per-vertex colors, colors for imported models' own materials (.mtl), a color palette UI. (Unlit materials: see `STORY.unlit-meshes.md`. Opacity, next to the color picker: see `STORY.mesh-transparency.md`.)
