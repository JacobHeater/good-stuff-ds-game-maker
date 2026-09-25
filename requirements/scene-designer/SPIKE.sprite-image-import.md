---
status: proposed
component: scene-designer
related: [SPIKE.custom-mesh-and-sprite-import.md, EPIC.scene-designer.md, compiler/STORY.compile-2d-scene-to-nds-rom.md, file-browser]
---

# Spike: Importing sprite and texture images

## Context
Split out of `SPIKE.custom-mesh-and-sprite-import.md`, whose mesh half was answered
by `STORY.import-obj-model.md`. 2D nodes (`Sprite2D`, `AnimatedSprite2D`) exist in
the scene tree but nothing is drawn from an image, and `compiler/STORY.compile-2d-scene-to-nds-rom.md`
is blocked on that. **Update:** PNG *textures on 3D meshes* were built separately
(`STORY.mesh-textures.md`), which already settled several questions this Spike would
otherwise ask: PNG is decoded in the main process (pngjs), converted to the DS's 16-bit
direct-color format, refused (not resized) when a side isn't a power of two from 8 to
1024, and stored embedded and already converted in the project file. What remains
open for **2D sprites** is the OAM sprite sizes, palettes (grit, 16/256 colors), and how a
sprite sheet or animation frames are described.

## Description
Investigate and recommend an approach for bringing images into a project:
- Formats (PNG is the obvious source) and the DS's real constraints: 15-bit color,
  palette sizes, power-of-two sprite dimensions, the OAM sprite sizes, and how
  `grit` (bundled in devkitPro) converts images.
- Storage. The OBJ decision was to embed in the `.gsds`; images are bigger and
  binary, so check whether embedding (base64) still holds or a project directory is
  finally warranted, and what that does to Save As, Export and Play.
- How an image's real size replaces the current fixed sprite count in the hardware budget.
- How the file browser shows imported assets.

## Acceptance Criteria
```gherkin
Scenario: Spike produces a written recommendation
  Given the open questions above
  Then a short written recommendation exists covering formats, DS constraints, storage and budget integration
  And it says what should become Stories and what is out of scope
```

## Notes
- Do not implement image import as part of this spike.
