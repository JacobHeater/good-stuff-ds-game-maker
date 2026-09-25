---
status: done
component: scene-designer
related: [EPIC.scene-designer.md, SPIKE.sprite-image-import.md, STORY.import-obj-model.md, STORY.choose-mesh-primitive.md, TASK.texture-uv-coordinates.md, persistence/TASK.embed-imported-textures-in-project-file.md, compiler/TASK.compile-textures.md, debugger/STORY.hardware-budget-report.md, properties-panel/STORY.inspector-panel.md, TASK.undo-redo-for-scene-edits.md]
---

# Story: Put a PNG texture on a 3D mesh

## Context
Every mesh is one flat grey. The DS's 3D engine can map a picture onto a mesh, and the
compiler, viewport and hardware budget already share one geometry definition, so a texture
can go through the same path: import an image, choose it for a mesh, see it in the editor,
and get it in the ROM. This is the "image assets" half of the old
`SPIKE.custom-mesh-and-sprite-import.md`, narrowed to **3D mesh textures**; 2D sprite images
stay in `SPIKE.sprite-image-import.md` (2D compilation doesn't exist yet).

## Decisions (made with the product owner)
- **Scope: 3D mesh textures only.** Sprites and 2D come later.
- **Size: refuse at import.** Each side must be a power of two from 8 to 1024 pixels. Any other
  size is refused with the image's size and what is allowed; nothing is resized, padded or
  stretched on the user's behalf. (Same stance as `.obj` import: the user fixes the source.)
- **Format: 16-bit direct color.** 5 bits per color channel plus a 1-bit on/off transparency
  flag, 2 bytes per pixel, no palette. A 128x128 texture is 32 KB of the DS's 512 KB texture
  memory. 256-color palettes are a possible later addition.

Choices I made without asking (say if any is wrong):
- **PNG only.** Decoded in the Electron main process (deterministic, handles every PNG variant).
- **Embedded in the project file, already converted.** The project stores the texture as the
  DS will see it (5-bit color, 1-bit alpha), not the original PNG. So the editor's viewport
  shows exactly what the ROM shows, the file is half the size of raw RGBA, and nothing
  depends on the original file staying put. The original PNG isn't kept.
- **One texture per mesh instance,** chosen in the Inspector; many meshes can share one texture.
- **UV coordinates:** the four primitives get built-in UV mapping; an imported `.obj` model uses
  its `vt` coordinates (previously ignored) and can't be textured if it has none. UVs outside
  0..1 tile the texture.
- **A textured mesh is drawn in white** (the DS multiplies the texture by the mesh's lit color,
  so the grey used for plain meshes would darken the picture).
- **Transparency:** alpha of 128 or more is opaque, below is clear; partly transparent pixels
  are reported as a warning at import.

## Description
- In the Inspector, a MeshInstance3D shows a **Texture** field: "None" or any of the project's
  textures (listed by name and size), plus an **Import PNG...** button that asks for a file,
  converts it, adds it to the project and applies it to the selected mesh.
- The viewport draws the texture on the mesh with nearest-neighbor sampling (blocky, as on the DS).
- The Hardware tab shows a **texture memory** bar: the total bytes of the distinct textures the
  scene uses, out of the DS's 512 KB.
- Export ROM and Play compile the scene with its textures; the compiler refuses a scene whose
  textures don't fit, a mesh whose model has no UVs, or a mesh naming a texture that isn't in the project.
- A texture no mesh uses isn't written to the project file the next time it's saved.
- Importing, choosing and clearing a texture are undoable.

## Acceptance Criteria
```gherkin
Scenario: The Inspector offers textures on a mesh
  Given a MeshInstance3D is selected
  Then the Inspector shows a Texture field set to None, and an "Import PNG..." button
  And a node that isn't a mesh shows neither

Scenario: Importing a PNG textures the selected mesh
  When "Import PNG..." is used and a valid 16x16 PNG is picked
  Then the texture is added to the project and applied to the selected mesh
  And the viewport draws the picture on the mesh
  And the Output log says it was imported, with its size and memory cost

Scenario: Cancelling the file dialog does nothing
  When the dialog is cancelled
  Then the project is unchanged and shows no unsaved changes

Scenario: A size the DS can't use is refused
  Given a 100x60 PNG
  When it is imported
  Then nothing is added
  And the Output log gives the image's size and says each side must be a power of two from 8 to 1024

Scenario: A file that isn't a usable PNG is refused
  Given a file that isn't a PNG, or an empty image
  Then it is refused with a reason and nothing is added

Scenario: Too big for the DS's memory is refused
  Given a 1024x1024 PNG (2 MB)
  Then it is refused, saying how much texture memory it would need and how much the DS has

Scenario: Partial transparency is reported
  Given a PNG with partly transparent pixels
  Then it imports and the Output log says they became fully opaque or fully clear

Scenario: Textures can be reused, switched and cleared
  Given a texture has been imported
  Then another mesh's Texture field lists it by name and size
  And choosing it draws it; choosing None draws the plain mesh again

Scenario: Primitives are mapped upright
  Given a picture with distinct colored quadrants on a plane, a cube face, a cylinder and a sphere
  Then it appears the right way up and not mirrored (on the plane and on a cube's front face)

Scenario: A model without UVs can't be textured
  Given a mesh that uses an imported model with no texture coordinates
  Then its Texture field is disabled and says why
  And switching a textured mesh to such a model clears its texture

Scenario: An imported model's UVs are used
  Given an .obj model with vt coordinates
  Then a texture on it follows those coordinates, with the picture upright (OBJ's v axis points up, images' points down)

Scenario: The hardware budget counts texture memory
  Given a scene with a 64x64 and a 32x32 texture, one of them on two meshes
  Then the Hardware tab shows 8192 + 2048 = 10240 bytes of 524288

Scenario: The texture is saved with the project and reopens
  Given a project with a textured mesh
  When it is saved, closed and reopened
  Then the mesh is still textured and the picture is unchanged

Scenario: Unused textures are not saved
  Given a texture that no mesh uses
  When the project is saved
  Then the file does not contain it

Scenario: Texture edits are undoable
  When a texture is imported, chosen or cleared
  Then Ctrl+Z restores the mesh and, for an import, removes the texture from the project

Scenario: The ROM draws the texture
  Given a scene with a textured plane and cube
  When it is compiled and run in the emulator
  Then the top-left, top-right, bottom-left and bottom-right of the picture show the source image's colors, upright

Scenario: A scene that doesn't fit is refused
  Given textures that together need more than 512 KB
  When the scene is exported
  Then the compiler refuses it, giving the total and the limit
```

## Notes
- **Built and verified.** `pnpm test` (250 tests, 56 of them new: UV orientation, the `vt` parser, DS-format
  conversion and its refusals, budget, schema, translation, the store's texture edits and undo);
  `tests/prototypes/e2e/texture-mesh.mjs` (13 checks against the real app, with real PNG files, run once after the
  last change); and `pnpm test:rom` (12 emulator tests).
  - **In the UI script:** the Inspector shows Texture/Import PNG on meshes only; cancelling changes nothing (and the
    dialog is filtered to .png); a 100 x 60 image, a 1024 x 1024 image and a file that isn't a PNG are each refused
    with a reason and add nothing; importing a quadrant picture makes the **viewport draw red, green, blue and yellow**
    (about 2100-2400 pixels each, counted from a screenshot of the canvas); the Hardware tab counts texture memory by
    distinct texture (512, then 512 + 2048 of 524288); partly transparent pixels are warned about; textures can be
    switched and cleared; saving embeds a shared texture once and drops unused ones, with the right texel in each corner
    of the stored data; closing and reopening keeps them; Ctrl+Z / Ctrl+Shift+Z undo and redo an import (and the file
    follows); a model with no UVs can't be textured and says why, one with UVs can, and switching a textured mesh to a
    model without UVs clears its texture, undoably; a real Export ROM builds a valid `.nds`; and unused textures aren't
    saved.
  - **In the emulator:** the textured plane and cube fixture is sampled at the picture's eight quadrant centers and
    every one is the source image's color, upright (the test fails if the picture is wrong: swapping red and green in
    the fixture makes it fail). A second fixture puts the picture on all four primitives; its silhouette matches the
    reference, and looking at the picture shows the sphere, cylinder side and cap, cube faces and plane mapped as designed.
- **Not verified / known limits:**
  - The sphere's and cylinder's *mapping* was checked by geometry tests and by eye in the emulator, not by sampling
    colors (only the plane and cube front are sampled). The editor viewport was checked on a cube only.
  - Lighting multiplies the texture, so the emulator test classifies by dominant channel, not exact color, and the
    viewport's lighting is three.js's, not the DS's.
  - Texture memory is a simple sum against 512 KB. The DS allocator can fragment, so a scene near the limit might not
    fit even when the sum does; not tested near the limit in the emulator.
  - Partly transparent pixels are only checked in the conversion (unit tests) and the warning, not drawn in the ROM.
    Transparent texels on the DS may also sort oddly against other transparent polygons.
  - Only PNG; the original file isn't kept, so a texture can't be re-exported; 16-bit color only.
- Not in this first cut: 256-color palettes, compressed textures, texture filtering options, per-mesh color
  tint, animated textures, per-material textures on a model, 2D sprite images, and keeping the original PNG.
- Verification this ticket depends on: `pnpm test` (conversion, UVs, parser, budget, schema, translation),
  `tests/prototypes/e2e/texture-mesh.mjs` (the real UI, viewport colors sampled from the canvas) and
  `pnpm test:rom` (colors sampled from melonDS's screen).
