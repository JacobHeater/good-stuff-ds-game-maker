---
status: done
component: scene-designer
related: [STORY.mesh-textures.md, TASK.obj-parser.md, STORY.choose-mesh-primitive.md, compiler/TASK.compile-textures.md]
---

# Task: UV coordinates for primitives and imported models

## Context
A texture needs to know where on the mesh each part of the picture goes: a UV (texture)
coordinate per vertex. The four built-in primitives have none, and the `.obj` parser
ignores `vt` lines (`TASK.obj-parser.md`).

## Description
**Convention: image space.** `u` runs left to right and `v` runs **top to bottom**, both
0..1 across the picture, so the first row of pixels is `v = 0`. Both the editor viewport
(three.js, no vertical flip) and the DS (texture `t` grows downward) use this directly.
OBJ files put `v` at the bottom, so the importer converts (`v_image = 1 - v_obj`).

**Geometry:** `PrimitiveGeometry` gains an optional `uvs` (two numbers per vertex, same vertex
count as `positions`); an `ImportedMesh` gains an optional `uvs` per unique vertex. Everything
that expands a mesh to a triangle list carries them.

**Primitives** (each seen from outside, picture upright):
- **Cube:** every face shows the whole picture, upright, with `u` running left to right as seen
  from outside; the top (+Y) and bottom (-Y) faces are oriented so the picture's top edge is
  toward -Z (top) and +Z (bottom).
- **Plane:** the picture is upright when the plane is viewed from above (+Y) with -Z away from
  the viewer: `u` follows +X, `v` follows +Z.
- **Cylinder:** the side wraps the picture once around (`u` around, `v` from the top edge down),
  and each cap shows the picture as a disc-shaped cut-out (planar mapping on X/Z).
- **Sphere:** equirectangular: `u` around the equator, `v` from the top pole (0) to the bottom (1).
  The seam column repeats `u = 1` so the wrap doesn't smear the picture across the whole width.

**Importer:** `vt u v` lines are read (a third `w` is ignored); a face vertex `v/vt/vn` or
`v/vt` picks its UV; unique vertices now depend on position, normal **and** UV. A model is
"textured" only if every used face corner has a `vt`; a file with `vt` on some faces but not
others is imported without UVs, with a warning naming that. The "texture coordinates were
ignored" warning goes away when they're kept. Out-of-range `vt` indices are an error like a
bad vertex index. UVs are rounded to 5 decimals like positions.

## Acceptance Criteria
```gherkin
Scenario: Every primitive has UVs
  Then each primitive's uvs has two numbers per vertex
  And every UV of the cube, plane and sphere is within 0..1

Scenario: Cube faces are upright and unmirrored
  Given a cube seen from outside face-on
  Then the face's top-left corner has UV (0, 0) and its bottom-right has (1, 1)

Scenario: The plane is upright from above
  Then its far-left corner (-X, -Z) has UV (0, 0) and its near-right corner (+X, +Z) has (1, 1)

Scenario: The sphere wraps without smearing
  Then u increases around the equator once, and the seam has vertices with u = 0 and u = 1

Scenario: The OBJ importer keeps vt coordinates
  Given faces written v/vt and v/vt/vn
  Then the mesh has one UV per unique vertex, with v flipped to image space

Scenario: Different UVs split a vertex
  Given one position used with two different vt values
  Then the mesh has two vertices there

Scenario: Partial UVs are dropped, with a warning
  Given some faces have vt and some do not
  Then the mesh has no UVs and the warning says so

Scenario: A bad vt index is refused
  Given a face naming a vt that doesn't exist
  Then the import is refused with the line number

Scenario: The DS-side geometry expands with UVs
  Given a mesh with UVs
  Then its expanded triangle list has UVs in step with its positions
```

## Notes
- **Done.** `PrimitiveGeometry.uvs` and `ImportedMesh.uvs`; the parser's `vt` support. `uv-coordinates.test.ts` (8 tests)
  checks orientation *geometrically*: for every cube face it computes "right" and "down" as seen from outside and
  verifies each UV follows them, rather than restating the table I derived; likewise for the plane, the cylinder's
  side and caps, and the sphere. Plus 6 parser tests. The plane sits upright when viewed from above with -Z away.
- The parser gained a warning for partial UVs ("Only some faces have texture coordinates ...") and for `vt` lines no
  face uses; the old "Texture coordinates were ignored" warning is gone, since they are kept now.
- `MESH_PRIMITIVES` triangle counts are unchanged (168 / 48 / 12 / 2): UVs are extra data per
  vertex, not extra triangles.
