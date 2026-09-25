---
status: done
component: compiler
related: [EPIC.compile-and-export-nds-rom.md, TASK.compile-imported-meshes.md, TASK.ds-runtime-c-template.md, TASK.ds-scene-intermediate-representation.md, scene-designer/STORY.mesh-textures.md, scene-designer/TASK.texture-uv-coordinates.md, persistence/TASK.embed-imported-textures-in-project-file.md]
---

# Task: Compile textures into the ROM

## Context
The runtime draws constant tables the compiler emits. A texture adds two kinds of data: the
texture images themselves, and a texture coordinate per vertex.

## Description
- **Texture data.** Each distinct texture a drawn mesh uses becomes one table of 16-bit
  texels (already in the DS format; the compiler copies them) with its size class (the DS
  encodes 8..1024 as 0..7). The runtime uploads them to texture memory at startup.
- **Per-vertex texture coordinates.** The DS takes coordinates in texels as 12.4 fixed point
  (`t16`), so they depend on the texture's size. Vertex tables are therefore keyed by
  geometry **and** texture: a cube drawn plain and a cube drawn with a texture are two tables
  (the textured one carries `texcoords`); two meshes with the same geometry and texture share one.
- **Mesh data.** A textured mesh is drawn with a white diffuse color (the DS multiplies the
  texture by the lit color) and refers to its texture by index; 0 means none.
- **Runtime.** At start it maps all four VRAM banks as texture memory, uploads each texture, and
  before each mesh binds its texture (or none). Texture wrapping is set to repeat, so UVs outside
  0..1 tile. The constant-data layout in `scene.h` and the generator in `scene-data-writer.ts` stay in step.
- **Diagnostics (errors, before any build):** a mesh whose `textureId` isn't in the project
  (`missing-texture`, naming the node); a textured mesh whose model has no UVs (`texture-needs-uvs`,
  naming the node); the drawn scene's distinct textures needing more than the DS's 512 KB texture
  memory (`texture-memory`, giving the total and the limit); and a UV that doesn't fit the DS's
  coordinate range (`out-of-range`, naming the node).

## Acceptance Criteria
```gherkin
Scenario: A textured mesh compiles
  Given a mesh with a texture
  Then the scene has that texture with its size class and texels
  And the mesh's vertex table has two texture coordinates per vertex
  And the mesh refers to the texture and is drawn white

Scenario: Texture coordinates are in texels
  Given a 16x16 texture and a vertex with UV (0.5, 1)
  Then its coordinates are (128, 256) (8 and 16 texels, times 16)

Scenario: Sharing
  Given three meshes with one cube and one texture, and one plain cube
  Then there are two vertex tables and one texture

Scenario: The same geometry with different textures gets separate tables
  Given two cubes with textures of different sizes
  Then there are two vertex tables, with texture coordinates that reflect each size

Scenario: Only drawn meshes' textures are included
  Given a hidden mesh with a texture no visible mesh uses
  Then that texture isn't in the ROM

Scenario: Missing texture, missing UVs and out-of-range UVs are errors naming the node

Scenario: Too much texture memory is an error with numbers
  Given textures needing 1 MB
  Then compilation is refused, stating the total and 524288 bytes

Scenario: The generated C is stable and valid
  Given the same project twice
  Then the generated C is byte-identical
  And a texture's name can't break out of a comment

Scenario: The ROM draws the texture upright
  Given a textured plane and cube built and run in the emulator
  Then sampled colors at the picture's four quadrants match the source image
```

## Notes
- **Done.** `toT16` in `fixed-point.ts`; `DsTexture`, `texcoords` and `texture` in `ds-scene.ts`; the checks and
  tables in `translate-scene-3d.ts`; the writer; and the C runtime (`scene.h`, `main.c`: maps all four VRAM banks as
  texture memory, uploads every texture once with wrapping on, binds one per mesh). Covered by 11 tests in
  `textured-meshes.test.ts` and the emulator tests. New diagnostic codes: `missing-texture`, `texture-needs-uvs`,
  `texture-memory`.
- **libnds detail worth knowing:** `glTexImage2D` takes the DS's size *class* (0..7) in its size arguments, not a pixel
  count, so `GsTexture` carries `sizeS`/`sizeT` computed at compile time. The first attempt cast to a
  `GL_TEXTURE_SIZE_ENUM` that this libnds version doesn't have, which the toolchain caught at build.
- Fixtures: `texturedProject` (plane + cube, sampled for color) and `texturedPrimitivesProject` (one of each
  primitive). The CLI takes `fixture:textured` and `fixture:textured-shapes`.
- The committed fallback `runtime/source/scene_data.c` (the cube fixture) is regenerated because the
  layout changed; a test keeps it in step with the generator.
- Lighting multiplies the texture, so sampled colors in the emulator are checked by dominant channel,
  not exact value.
