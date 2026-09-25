---
status: done
component: persistence
related: [EPIC.project-persistence.md, TASK.embed-imported-meshes-in-project-file.md, scene-designer/STORY.mesh-textures.md, compiler/TASK.compile-textures.md]
---

# Task: Store imported textures inside the project file

## Context
`scene-designer/STORY.mesh-textures.md` embeds textures in the `.gsds`, the same way
`TASK.embed-imported-meshes-in-project-file.md` embeds models.

## Description
- `ProjectSnapshot` gains an optional `textures: ImportedTexture[]`. An `ImportedTexture` is
  `{ id, name, width, height, texels }`, where `texels` is the picture **already converted to the
  DS's 16-bit format**, as base64 of little-endian 16-bit values: red in bits 0-4, green 5-9,
  blue 10-14 and the opaque flag in bit 15 (the value a DS texture holds, and what
  `glTexImage2D` takes). Row 0 is the top of the picture.
- A mesh refers to a texture by `mesh.textureId` (optional; a mesh with no texture has none).
- **`formatVersion` stays 1**, for the same reason as models: both additions are optional, an existing
  file is untouched and written back unchanged (no `textures` key when there are none). An older
  build of the app rejects a file that contains a texture.
- `withUpdatedScene` drops textures that no mesh uses, and the key disappears when none remain.
- The schema validates the shape. The validator also checks what the schema can't: `width` and
  `height` are each a power of two from 8 to 1024; `texels` is well-formed base64 that decodes to
  exactly `width * height * 2` bytes; ids are unique; and every `textureId` names a texture in the file.

## Acceptance Criteria
```gherkin
Scenario: Existing projects are unaffected
  Given a project saved before textures existed
  Then it opens, and saving it again writes no "textures" field

Scenario: A textured project round-trips
  Given a project with a texture and a mesh that uses it
  When it is saved and reopened
  Then the texture's data is identical and the mesh still refers to it

Scenario: A dangling reference is rejected
  Given a mesh whose textureId isn't in the file
  Then opening it fails with a message naming the mesh

Scenario: A malformed texture is rejected
  Given a size that isn't a power of two, texel data of the wrong length, or text that isn't base64
  Then validation fails

Scenario: Duplicate ids are rejected

Scenario: Unused textures are not written
  Given a texture no mesh refers to
  When the project is saved
  Then the file has no such texture, and no "textures" field if none are left
```

## Notes
- **Done:** `ImportedTexture` and `textures` in core; the schema; the validator's cross-checks (size, base64 shape
  and exact decoded length, unique ids, dangling `textureId`, model UVs of the right length); `withUpdatedScene`
  pruning. 8 tests in `imported-texture-schema.test.ts`, plus the real-file checks in `texture-mesh.mjs`.
- File size: base64 of 2 bytes per pixel. 128x128 is about 44 KB in the file, 256x256 about 175 KB.
