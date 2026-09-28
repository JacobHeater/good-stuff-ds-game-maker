---
status: done
component: scene-designer
related: [STORY.mesh-colors.md, STORY.mesh-textures.md, STORY.unlit-meshes.md, STORY.mesh-face-culling.md, STORY.directional-light-intensity.md]
---

# Story: Mesh transparency

## Context
Owner request: "add support for transparent textures and be able to change transparency in our color picker." Textures already carried an alpha channel on import (`imported-texture.ts`), but it was only ever used
as a 1-bit on/off punch-through (`STORY.mesh-textures.md`) — a mesh itself had no opacity of its own, and the runtime drew every polygon fully opaque (`POLY_ALPHA(31)` was a hardcoded constant in `main.c`, not a
per-mesh value). There was no way to make a whole mesh translucent, and nothing in the Inspector's color picker to control it.

## Decisions (owner delegated; say if any is wrong)
- A `MeshInstance3D` has an optional **opacity** (`mesh.alpha`, 0..1, absent = 1 = fully opaque, the existing behavior). It compiles to the DS's polygon alpha, 0..31, the same 31-level scale a light's intensity
  already uses (`alphaLevelFromOpacity`/`getMeshOpacity` in `mesh-color.ts`, mirroring `lightLevelFromIntensity`/`getLightIntensity`).
- Inspector: a 0-100% slider ("Opacity") next to the mesh's color and cull fields, showing the DS level it maps to, styled after the light's own `IntensityField`. Dragging it is one undo step per pause
  (`SET_MESH_ALPHA`, merged like `SET_MESH_COLOR` and `SET_LIGHT_INTENSITY`).
- Texture transparency itself needed no new work: a texel with its alpha below 128 was already stored fully clear (`createTextureFromRgba`'s bit 15) and the runtime already uploads textures as `GL_RGBA`
  (libnds's A1RGB5 format), which the DS geometry engine already punches through in hardware with no per-application code. This story is what was actually missing: a *mesh's own* translucency, which combines
  with a texture's punch-through automatically (they're independent hardware mechanisms) and is the only lever the DS gives for a gradient of opacity, since a texel's own alpha is on/off only.

## Description
- Core: `MeshInstance3DData.alpha?: number` (`scene-node.ts`); schema allows it, 0..1 (`project-snapshot.schema.ts`).
- Compiler: `DsMesh.alpha` (`ds-scene.ts`), set from `alphaLevelFromOpacity(node.mesh.alpha ?? 1)` (`translate-scene-3d.ts`); emitted as `GsMesh`'s own trailing field (`scene-data-writer.ts`; bumped `GsMesh`'s
  layout, so existing exact-string C-output tests and the checked-in `scene_data.c` fallback needed updating, same as any struct-layout change).
- Runtime (`main.c`): `POLY_ALPHA(31)` is now `POLY_ALPHA(mesh->alpha)`, per mesh. Opaque meshes (alpha 31) draw in a first pass, translucent ones (alpha < 31) in a second, each given its own `POLY_ID` (the DS
  doesn't depth-write a translucent polygon at all, so drawing opaque first keeps a translucent mesh from being wrongly drawn over later by an opaque one behind it; a unique ID per translucent mesh keeps two
  different translucent meshes sorting against each other, while a single mesh's own triangles sharing one ID hides its own seams instead of self-sorting them). A mesh at alpha 0 is skipped entirely.
  `glEnable(GL_BLEND)` is also now set at startup (with `GL_TEXTURE_2D`): the geometry engine stores a polygon's alpha regardless, but never actually blends with it unless blending is turned on, so without this
  every mesh drew fully opaque no matter its `POLY_ALPHA` (found by the owner: correct in the editor's viewport, which does its own three.js blending, but not in melonDS, which showed the real gap).
- UI: `OpacityField` in `InspectorPanel.tsx`; viewport parity via `ds-lighting-material.ts`'s new `uOpacity` uniform and fragment-shader alpha output, with `transparent`/`depthWrite` set to match the DS's own
  no-depth-write-below-full-alpha rule (`Viewport3D.tsx` passes `getMeshOpacity(mesh)`).

## Notes (built and verified)
- Unit tests: `core/src/mesh-color.test.ts` (the new opacity helpers), `compiler/src/mesh-alpha.test.ts`, `ui/.../mesh-alpha-edits.test.ts`.
- **Not yet re-verified by the owner in melonDS** after the `GL_BLEND` fix above (the first build, without it, looked right in the editor but drew every mesh opaque in melonDS -- this is the fix for that report).
- **Not verified:** an automated ROM/emulator test for this (no `testing/*.rom.test.ts` case yet, so a future regression here wouldn't be caught automatically). **Not built:**
  sorting translucent *meshes* against each other back-to-front by distance (each gets a distinct poly ID so they still depth-test against each other correctly, but draw order between them is the scene's own
  order, not resorted per frame); gradient/partial texel alpha (a hardware limit — see `STORY.mesh-textures.md`); an alpha-aware native color-picker control (the color swatch is still the browser's own
  `<input type="color">`, which has no alpha channel; opacity is a separate slider next to it, not a single RGBA control).
