---
status: done
component: scene-designer
related: [TASK.obj-parser.md, STORY.import-obj-model.md, STORY.mesh-face-culling.md]
---

# Story: Recalculate normals on import

## Context
Owner report: an imported mountain mesh read as a flat dark shape, but only from certain camera angles or from far away on
one side — not the whole mesh, and not from every angle. Face culling (`STORY.mesh-face-culling.md`) turned out not to be the
cause (a uniformly reversed-winding mesh would look wrong from *every* angle, not just some); the real cause is that the
`.obj` parser (`obj-import.ts`) always trusted a face's own `vn` normal exactly as the file gave it, with no check against the
triangle's actual shape. A model whose own normals partially disagree with its real geometry (common from some terrain/export
tools) imports faithfully, wrong parts and all — which faces read wrong then depends on which ones the camera happens to be
looking at, matching exactly what was reported.

## Decisions (owner delegated; say if any is wrong)
- `ObjImportOptions` gains `recalculateNormals?: boolean`: when set, a face's own `vn` is ignored entirely and each triangle's
  own normal (already computed from its three corners, for the "file has no normals at all" fallback) is used instead — this
  guarantees the normal is geometrically correct for that triangle's winding, at the cost of flat, per-face shading instead of
  whatever smooth shading the file's own normals gave it.
- Asked once per import, as a native Yes/No-style dialog right after picking the file(s) (`assets-ipc.ts`'s `askRecalculateNormals`), not a new dialog/checkbox built in the renderer: "Use the file's own normals" (the default, unchanged behavior) or "Recalculate from the model's shape". The same answer applies to every file when importing several as one animated model's poses.

## Description
- Core: `ObjImportOptions.recalculateNormals` (`obj-import.ts`): skips the `corner.normal !== undefined` branch that would
  otherwise override the already-computed face normal; a new warning names what happened when it changes anything.
- Desktop (`assets-ipc.ts`): `askRecalculateNormals()` (a `dialog.showMessageBox`), asked once before parsing, its answer
  threaded into both the single-file and multi-file (poses) `parseObj` calls.

## Notes (built and verified)
- Unit tests: `core/src/obj-import.test.ts` — a deliberately-wrong `vn` (pointing opposite of the triangle's real winding) is
  trusted as-is by default, and correctly overridden (matching the triangle's own computed normal) with the option set, with
  the right warning.
- **Not built:** recalculating for an already-imported model without re-importing it (the mountain needs to be re-imported to
  pick this up); smooth (vertex-averaged, blending across adjacent faces) recalculated normals — only flat, per-face ones are
  produced, which suits faceted/rocky geometry (like the owner's mountain) better than a smooth, rounded model.
