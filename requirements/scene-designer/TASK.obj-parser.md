---
status: done
component: scene-designer
related: [STORY.import-obj-model.md, persistence/TASK.embed-imported-meshes-in-project-file.md, compiler/TASK.compile-imported-meshes.md]
---

# Task: A Wavefront .obj parser that produces DS-ready geometry

## Context
`STORY.import-obj-model.md` needs the text of an `.obj` turned into a mesh the
editor, budget and compiler can share, or a clear refusal. It lives in
`@goodstuff/core` (pure, no file access) so it is unit-testable and can be used
from the Electron main process, which reads the file.

## Description
`parseObj(text, { name })` returns either the imported mesh plus warnings, or a
list of errors. It handles:
- `v x y z` (a fourth `w` is ignored), `vn x y z`, and `f` with `v`, `v/vt`, `v//vn`
  and `v/vt/vn` vertices, including **negative (relative) indices**.
- Faces of any size by fan triangulation (a quad becomes two triangles; concave
  polygons are not repaired, which is noted in the docs, not silently mangled).
- Normals from `vn` where a face has them; a flat per-face normal where it doesn't.
  Zero-length or missing normals fall back to the face normal.
- Degenerate (zero-area) triangles are dropped and counted in a warning.
- Ignored, with a warning that names what was skipped: `mtllib` / `usemtl`
  (materials) and line and point elements. (`vt` texture coordinates were ignored at first and are now kept:
  see `TASK.texture-uv-coordinates.md`.) Comments,
  object/group/smoothing lines are accepted and ignored silently.
- Output is indexed: unique vertices (position + normal), plus a triangle index
  list. Numbers are rounded to 5 decimal places (finer than the DS's 4.12
  fixed point can hold) to keep project files small.

It refuses, with a message and a line number where there is one:
- no faces at all;
- a face that names a vertex or normal that doesn't exist, or index 0;
- a coordinate that isn't a finite number;
- any position outside the DS vertex range (limit `MAX_IMPORTED_COORDINATE`,
  the largest magnitude a `v16` can hold, 32767/4096), naming the vertex and value;
- more triangles than one frame can draw (`DS_HARDWARE_PROFILE.graphics3D.approxTrianglesPerFrame`),
  giving the model's count and the limit;
- more than a handful of errors are summarized ("and N more") so a garbage
  file doesn't produce thousands of lines.

## Acceptance Criteria
```gherkin
Scenario: A triangle list imports
  Given an .obj with one triangle
  Then the mesh has 3 vertices and 1 triangle

Scenario: Face formats
  Given faces written as v, v/vt, v//vn and v/vt/vn
  Then each imports with the right vertex positions

Scenario: Relative indices
  Given a face using negative indices
  Then it refers to the vertices declared just before it

Scenario: Quads and polygons are triangulated
  Given a quad and a pentagon
  Then they produce 2 and 3 triangles

Scenario: Normals
  Given faces with vn normals
  Then those normals are used
  Given faces with none
  Then each face gets a unit-length flat normal that agrees with its winding

Scenario: Degenerate triangles are dropped
  Given a zero-area face
  Then it is not in the mesh and a warning says so

Scenario: Ignored content is named
  Given mtllib, usemtl and vt lines
  Then the mesh imports and the warnings say materials were ignored, and that texture coordinates no face uses
  can't texture the model

Scenario: Bad files are refused
  Given no faces, a face naming a missing vertex, index 0, a non-numeric coordinate
  Then each is refused with a message, naming the line where there is one

Scenario: Limits
  Given a vertex beyond the DS vertex range
  Then the import is refused naming the value and the limit
  Given more triangles than a frame can draw
  Then the import is refused giving the count and the limit
  Given a model exactly at each limit
  Then it imports

Scenario: Windows line endings and extra whitespace
  Given a file with CRLF line endings, tabs and trailing spaces
  Then it imports the same as the clean file
```

## Notes
- **Done:** `packages/core/src/obj-import.ts`, with 32 tests in `obj-import.test.ts` covering every scenario
  above (both limits are tested exactly at, one over, and one under; unused far-away vertices don't count).
  Errors are reported once per bad face, not once per vertex, and a flood of them is summarized as
  "...and N more".
- When a model has no normals the result carries a warning saying so ("each face is shaded flat"), so the
  Output log tells the user why a smooth-looking model has facets.
- The mesh shape (`ImportedMesh`) is defined with the project format in
  `persistence/TASK.embed-imported-meshes-in-project-file.md`.
- No file I/O and no Electron here: the caller reads the file and passes the text.
